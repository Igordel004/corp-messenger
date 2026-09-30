module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // Новый функционал
        'fix',      // Исправление ошибки
        'docs',     // Документация
        'style',    // Форматирование кода (пробелы, точки с запятой)
        'refactor', // Рефакторинг без изменения логики
        'test',     // Добавление или правка тестов
        'chore',    // Служебные задачи (настройка сборки, пакетов)
        'ci'        // Настройка CI/CD
      ]
    ],
    'subject-case': [2, 'always', 'lower-case']
  }
};