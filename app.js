"use strict";

const SYSTEM_CONFIG = Object.freeze({
  appName: "相談支援事業所 独立採算シミュレーター",
  version: "Version 1.1.0",
  lastUpdated: "2026年11月19日",
  copyright: "© 社会福祉法人とよさと",
  provider: "社会福祉法人とよさと",
});

const DEFAULT_VALUES = Object.freeze({
  staffCount: 2,
  totalPersonnelCost: 10000000,
  personnelCostPerFte: 5000000,
  personnelCostRatio: 70,
  otherIncome: 3000000,
  targetAnnualSurplus: 0,
  averageUnitPrice: 18000,
  annualWorkHours: 1920,
  consultationTimeRatio: 60,
});

const FIELD_RULES = Object.freeze({
  staffCount: { label: "相談支援専門員の常勤換算人数", minExclusive: 0 },
  totalPersonnelCost: { label: "年間総人件費", minExclusive: 0 },
  personnelCostPerFte: { label: "常勤換算1.0人あたり年間人件費", minExclusive: 0 },
  personnelCostRatio: { label: "支出に占める人件費の割合", minExclusive: 0, max: 100 },
  otherIncome: { label: "委託費・その他収入", min: 0 },
  targetAnnualSurplus: { label: "目標とする年間黒字額", min: 0 },
  averageUnitPrice: { label: "計画相談の平均単価", minExclusive: 0 },
  annualWorkHours: { label: "年間労働時間", minExclusive: 0 },
  consultationTimeRatio: { label: "計画相談業務の時間割合", minExclusive: 0, max: 100 },
});

const hasDocument = typeof document !== "undefined";
const form = hasDocument ? document.querySelector("#simulator-form") : null;
const resultsContent = hasDocument ? document.querySelector("#results-content") : null;
const globalError = hasDocument ? document.querySelector("#global-error") : null;
const resultStatus = hasDocument ? document.querySelector("#result-status") : null;

const yenFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 });

function readInputs() {
  return {
    costMode: form.elements.costMode.value,
    ...Object.fromEntries(
    Object.keys(FIELD_RULES).map((id) => [id, Number(document.getElementById(id).value)])
    ),
  };
}

function validate(values) {
  const errors = {};

  Object.entries(FIELD_RULES).forEach(([id, rule]) => {
    if (id === "totalPersonnelCost" && values.costMode !== "total") return;
    if (id === "personnelCostPerFte" && values.costMode !== "perFte") return;
    const value = values[id];
    if (!Number.isFinite(value)) {
      errors[id] = `${rule.label}を入力してください。`;
    } else if (rule.minExclusive !== undefined && value <= rule.minExclusive) {
      errors[id] = `${rule.label}は0より大きい数字を入力してください。`;
    } else if (rule.min !== undefined && value < rule.min) {
      errors[id] = `${rule.label}は0以上で入力してください。`;
    } else if (rule.max !== undefined && value > rule.max) {
      errors[id] = `${rule.label}は${rule.max}%以下で入力してください。`;
    }
  });

  return errors;
}

// 将来追加予定の calculateAverageUnitPrice() などで単価を決定し、
// calculateScenario() には確定済みの averageUnitPrice を渡します。
// これにより、シナリオ計算は単価の算出方法に依存しません。

function buildTimeResult(totalConsultationHours, annualCasesRequired) {
  if (annualCasesRequired <= 0) {
    return {
      timePerCaseMinutes: null,
      timePerCaseHoursDecimal: null,
      timePerCaseDisplay: "算出不要",
    };
  }

  const timePerCaseHoursDecimal = totalConsultationHours / annualCasesRequired;
  const timePerCaseMinutes = Math.max(0, Math.round(timePerCaseHoursDecimal * 60));
  const wholeHours = Math.floor(timePerCaseMinutes / 60);
  const remainingMinutes = timePerCaseMinutes % 60;

  return {
    timePerCaseMinutes,
    timePerCaseHoursDecimal,
    timePerCaseDisplay: `${wholeHours}時間${remainingMinutes ? `${remainingMinutes}分` : ""}`,
  };
}

// 現在は1関数ですが、責務別の処理ブロックを保ち、将来の関数分割を容易にしています。
function calculateScenario(values) {
  // 1. 必要年間売上の計算
  const personnelCostRatio = values.personnelCostRatio / 100;
  const calculatedPersonnelCost = values.costMode === "perFte"
    ? values.personnelCostPerFte * values.staffCount
    : values.totalPersonnelCost;
  const breakEvenAnnualRevenue = calculatedPersonnelCost / personnelCostRatio;
  const requiredAnnualRevenue = breakEvenAnnualRevenue + values.targetAnnualSurplus;
  const requiredConsultationRevenue = Math.max(requiredAnnualRevenue - values.otherIncome, 0);

  // 2. 必要件数の計算（平均単価は外部で確定済みの値として受け取る）
  const annualCasesExact = requiredConsultationRevenue / values.averageUnitPrice;
  const annualCasesRequired = Math.ceil(annualCasesExact);
  const monthlyCasesExact = annualCasesExact / 12;
  const annualCasesPerStaffExact = annualCasesExact / values.staffCount;
  const monthlyCasesPerStaffExact = annualCasesPerStaffExact / 12;

  // 3. 利用可能時間の計算
  const consultationTimeRatio = values.consultationTimeRatio / 100;
  const totalConsultationHours = values.staffCount * values.annualWorkHours * consultationTimeRatio;

  // 4. 1件あたり時間の計算
  // 売上目標を下回らないよう、切り上げた年間必要件数で時間を割ります。
  const timeResult = buildTimeResult(totalConsultationHours, annualCasesRequired);

  return {
    calculatedPersonnelCost,
    breakEvenAnnualRevenue,
    requiredAnnualRevenue,
    requiredConsultationRevenue,
    annualCasesExact,
    annualCasesRequired,
    monthlyCasesExact,
    annualCasesPerStaffExact,
    monthlyCasesPerStaffExact,
    totalConsultationHours,
    ...timeResult,
  };
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function formatCases(value) {
  return `${new Intl.NumberFormat("ja-JP").format(Math.ceil(value))}件`;
}

function formatExactCases(value) {
  return `計算値 ${numberFormatter.format(value)}件`;
}

function applySystemConfig() {
  document.title = SYSTEM_CONFIG.appName;
  Object.entries(SYSTEM_CONFIG).forEach(([key, value]) => {
    document.querySelectorAll(`[data-config="${key}"]`).forEach((element) => {
      element.textContent = value;
    });
  });
}

function renderErrors(errors) {
  Object.keys(FIELD_RULES).forEach((id) => {
    const input = document.getElementById(id);
    const field = input.closest(".field");
    const error = document.querySelector(`[data-error-for="${id}"]`);
    const message = errors[id] || "";
    error.textContent = message;
    field.classList.toggle("is-invalid", Boolean(message));
    input.setAttribute("aria-invalid", String(Boolean(message)));
    if (message) input.setAttribute("aria-describedby", `${id}-error`);
    else input.removeAttribute("aria-describedby");
    error.id = `${id}-error`;
  });
}

function renderResults(result, values) {
  setText("calculatedPersonnelCost", yenFormatter.format(Math.ceil(result.calculatedPersonnelCost)));
  setText("breakEvenAnnualRevenue", yenFormatter.format(Math.ceil(result.breakEvenAnnualRevenue)));
  setText("targetAnnualSurplusResult", yenFormatter.format(Math.ceil(values.targetAnnualSurplus)));
  setText("requiredAnnualRevenue", yenFormatter.format(Math.ceil(result.requiredAnnualRevenue)));
  setText("requiredConsultationRevenue", yenFormatter.format(Math.ceil(result.requiredConsultationRevenue)));
  setText("annualCases", formatCases(result.annualCasesExact));
  setText("annualCasesExact", formatExactCases(result.annualCasesExact));
  setText("monthlyCases", formatCases(result.monthlyCasesExact));
  setText("monthlyCasesExact", formatExactCases(result.monthlyCasesExact));
  setText("annualCasesPerStaff", formatCases(result.annualCasesPerStaffExact));
  setText("annualCasesPerStaffExact", formatExactCases(result.annualCasesPerStaffExact));
  setText("monthlyCasesPerStaff", formatCases(result.monthlyCasesPerStaffExact));
  setText("monthlyCasesPerStaffExact", formatExactCases(result.monthlyCasesPerStaffExact));

  const surplusMessage = document.getElementById("surplus-message");
  setText(
    "fte-note",
    `「常勤換算1.0人あたり」は、現在の${numberFormatter.format(values.staffCount)}人分を1.0人分に割り戻した目安です。実際に在籍する職員1人ごとの件数ではありません。`
  );
  if (result.requiredConsultationRevenue === 0) {
    setText("timePerCasePrimary", "算出不要");
    setText("timePerCaseSecondary", "委託費・その他収入だけで必要年間売上を満たしています");
    surplusMessage.hidden = false;
    surplusMessage.textContent = `その他収入が必要年間売上を${yenFormatter.format(Math.floor(values.otherIncome - result.requiredAnnualRevenue))}上回っています。`;
  } else {
    setText("timePerCasePrimary", result.timePerCaseDisplay);
    setText(
      "timePerCaseSecondary",
      `約${numberFormatter.format(result.timePerCaseHoursDecimal)}時間（約${new Intl.NumberFormat("ja-JP").format(result.timePerCaseMinutes)}分）`
    );
    surplusMessage.hidden = true;
  }
}

function update() {
  const values = readInputs();
  const perFteMode = values.costMode === "perFte";
  document.getElementById("total-cost-field").hidden = perFteMode;
  document.getElementById("per-fte-cost-field").hidden = !perFteMode;
  const errors = validate(values);
  renderErrors(errors);

  if (Object.keys(errors).length > 0) {
    globalError.hidden = false;
    globalError.textContent = "入力内容を確認してください。赤く表示された項目を直すと、結果が再計算されます。";
    resultsContent.classList.add("is-disabled");
    resultStatus.textContent = "入力内容に確認が必要です。";
    resultsContent.setAttribute("aria-hidden", "true");
    return;
  }

  globalError.hidden = true;
  resultsContent.classList.remove("is-disabled");
  resultsContent.removeAttribute("aria-hidden");
  const result = calculateScenario(values);
  renderResults(result, values);
  resultStatus.textContent = result.annualCasesRequired === 0
    ? "計算しました。計画相談で必要な売上はありません。"
    : `計算しました。年間必要件数は${formatCases(result.annualCasesExact)}、1件あたりに充てられる時間は${result.timePerCaseDisplay}です。`;
}

if (hasDocument) {
  form.addEventListener("input", update);
  document.getElementById("reset-button").addEventListener("click", () => {
    Object.entries(DEFAULT_VALUES).forEach(([id, value]) => {
      document.getElementById(id).value = value;
    });
    form.elements.costMode.value = "total";
    update();
  });

  applySystemConfig();
  update();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SYSTEM_CONFIG,
    DEFAULT_VALUES,
    FIELD_RULES,
    validate,
    buildTimeResult,
    calculateScenario,
  };
}
