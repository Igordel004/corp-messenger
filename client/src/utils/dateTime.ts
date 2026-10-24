// Форматирование меток времени сообщений: дата и время выводятся
// отдельными полями в пузыре. Ручная сборка вместо toLocaleString
// делает вывод детерминированным на любой локали браузера.

// Двузначное представление компоненты даты (2 -> "02")
const pad = (value: number): string => String(value).padStart(2, '0');

// Дата сообщения в формате ДД.ММ.ГГГГ
export const formatMessageDate = (iso: string): string => {
  const date = new Date(iso);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
};

// Время сообщения в формате ЧЧ:ММ
export const formatMessageTime = (iso: string): string => {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
