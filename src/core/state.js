// Состояние партии — один контейнер на всех: его читают и меняют правила игры, звук, отрисовка и меню.
// state: 'menu' | 'play' | 'pause' | 'over'; mode: 'classic' | 'colors' | 'waves'; game — счёт текущей партии.
export const G = { state: 'menu', mode: 'classic', game: null, toastText: '', toastT: 0 };
