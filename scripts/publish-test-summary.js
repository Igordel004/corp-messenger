const fs = require('fs');

const readJson = (path) => {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

const results = readJson('test-results.json');
const coverage = readJson('coverage/coverage-summary.json');

const total = results?.numTotalTests ?? 0;
const passed = results?.numPassedTests ?? 0;
const failed = results?.numFailedTests ?? 0;
const files = results?.testResults?.length ?? 0;

const pct = (metric) => coverage?.total?.[metric]?.pct ?? 0;

const lines = [
  '## Отчёт о тестировании',
  '',
  `**Тесты:** ${passed} пройдено, ${failed} провалено, всего ${total} в ${files} файлах`,
  '',
  '| Метрика | Покрытие |',
  '| ------- | -------- |',
  `| Строки | ${pct('lines')}% |`,
  `| Ветвления | ${pct('branches')}% |`,
  `| Функции | ${pct('functions')}% |`,
  '',
];

if (failed > 0 && results?.testResults) {
  lines.push('### Проваленные тесты', '');
  for (const suite of results.testResults) {
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status === 'failed') {
        lines.push(`- ${suite.name}: ${assertion.title}`);
      }
    }
  }
  lines.push('');
}

lines.push(
  process.env.GITHUB_STEP_SUMMARY
    ? 'JUnit-отчёт и HTML-отчёт покрытия доступны в артефакте `test-artifacts`.'
    : 'JUnit-отчёт: `test-results/junit.xml`',
);

const markdown = lines.join('\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
} else {
  console.log(markdown);
}
