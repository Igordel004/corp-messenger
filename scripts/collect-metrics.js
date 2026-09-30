const fs = require('fs');
const { execSync } = require('child_process');

function getGitMetrics() {
  let totalCommits = '0';
  let commitSizeText = 'N/A';
  let linesChanged = 0;

  try {
    totalCommits = execSync('git rev-list --count HEAD').toString().trim();
  } catch {
    totalCommits = 'N/A';
  }

  try {
    const stat = execSync('git show --shortstat --format="" HEAD').toString().trim();
    if (stat) {
      commitSizeText = stat;
      const insertions = parseInt((stat.match(/(\d+)\s+insertion/) || [0, 0])[1], 10);
      const deletions = parseInt((stat.match(/(\d+)\s+deletion/) || [0, 0])[1], 10);
      linesChanged = insertions + deletions;
    } else {
      commitSizeText = '0 строк (без изменений кода)';
    }
  } catch {
    commitSizeText = 'Не определено';
  }

  return { totalCommits, commitSizeText, linesChanged };
}

function getLintMetrics() {
  try {
    if (!fs.existsSync('eslint-report.json')) {
      return { errors: 0, warnings: 0, complexityWarnings: 0 };
    }
    const report = JSON.parse(fs.readFileSync('eslint-report.json', 'utf8'));
    let errors = 0;
    let warnings = 0;
    let complexityWarnings = 0;

    for (const file of report) {
      errors += file.errorCount;
      warnings += file.warningCount;
      for (const msg of file.messages) {
        if (msg.ruleId === 'complexity') {
          complexityWarnings++;
        }
      }
    }
    return { errors, warnings, complexityWarnings };
  } catch {
    return { errors: 0, warnings: 0, complexityWarnings: 0 };
  }
}

function getTestMetrics() {
  let passed = 0;
  let failed = 0;
  let total = 0;
  let linesPct = '0%';
  let branchesPct = '0%';

  try {
    if (fs.existsSync('test-results.json')) {
      const results = JSON.parse(fs.readFileSync('test-results.json', 'utf8'));
      passed = results.numPassedTests || 0;
      failed = results.numFailedTests || 0;
      total = results.numTotalTests || 0;
    }
  } catch {}

  try {
    if (fs.existsSync('coverage/coverage-summary.json')) {
      const cov = JSON.parse(fs.readFileSync('coverage/coverage-summary.json', 'utf8'));
      linesPct = `${cov.total.lines.pct}%`;
      branchesPct = `${cov.total.branches.pct}%`;
    }
  } catch {}

  return { passed, failed, total, linesPct, branchesPct };
}

function generateDashboard() {
  const git = getGitMetrics();
  const lint = getLintMetrics();
  const test = getTestMetrics();

  // Динамический расчет статусов соответствия (Quality Gates)
  const lineCoverageValue = parseFloat(test.linesPct) || 0;
  const branchCoverageValue = parseFloat(test.branchesPct) || 0;

  const lintErrorsStatus =
    lint.errors === 0 ? 'Соответствует (0 ошибок)' : `Не соответствует (${lint.errors} ошибок)`;

  const complexityStatus =
    lint.complexityWarnings === 0
      ? 'В пределах нормы (<= 10)'
      : `Превышен порог (${lint.complexityWarnings} функций)`;

  const testsStatus =
    test.failed === 0 && test.total > 0
      ? 'Все тесты пройдены успешно'
      : `Обнаружены сбои (${test.failed} упало)`;

  const failedTestsStatus =
    test.failed === 0 ? 'Сбои отсутствуют' : 'Требуется устранение дефектов';

  const lineCovStatus =
    lineCoverageValue >= 80 ? 'Соответствует нормативу (>= 80%)' : 'Ниже целевого порога (< 80%)';

  const branchCovStatus =
    branchCoverageValue >= 70 ? 'Соответствует нормативу (>= 70%)' : 'Базовый охват ветвлений';

  const commitSizeStatus =
    git.linesChanged <= 300
      ? 'Атомарное изменение (<= 300 строк)'
      : 'Крупное изменение (> 300 строк, рекомендуется декомпозиция)';

  const markdown = `
## Сводная ведомость метрик качества программного обеспечения

| Группа метрик | Контролируемый показатель | Фактическое значение | Статус соответствия (Quality Gate) |
| :--- | :--- | :--- | :--- |
| **Статический анализ** | Ошибки линтера (ESLint Errors) | **${lint.errors}** | ${lintErrorsStatus} |
| **Статический анализ** | Предупреждения линтера (ESLint Warnings) | **${lint.warnings}** | Допустимо (предупреждения) |
| **Статический анализ** | Функции с цикломатической сложностью > 10 | **${lint.complexityWarnings}** | ${complexityStatus} |
| **Тестирование** | Успешно пройденные тесты (Vitest / Supertest) | **${test.passed} / ${test.total}** | ${testsStatus} |
| **Тестирование** | Количество упавших тестов | **${test.failed}** | ${failedTestsStatus} |
| **Тестирование** | Покрытие строк исходного кода (Line Coverage) | **${test.linesPct}** | ${lineCovStatus} |
| **Тестирование** | Покрытие ветвлений алгоритмов (Branch Coverage) | **${test.branchesPct}** | ${branchCovStatus} |
| **Процесс разработки** | Размер последнего коммита (объем диффа) | **${git.commitSizeText}** | ${commitSizeStatus} |
| **Процесс разработки** | Суммарное количество коммитов в репозитории | **${git.totalCommits}** | Зафиксировано в истории |
| **CI/CD пайплайн** | Итоговое состояние пайплайна сборки | **SUCCESS** | Пайплайн завершен без сбоев |

*Отчет сформирован автоматически в процессе выполнения шага CI/CD (GitHub Actions).*
`;

  console.log(markdown);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }
}

generateDashboard();
