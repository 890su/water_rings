// Платформа: телефон или компьютер, угол экрана, приложение Android (Capacitor), закрепление ориентации.


// Телефон или планшет — основной ввод пальцем. Сенсорный ноутбук или встроенный браузер с касаниями сюда не попадают
export const touchDevice = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
export function screenAngle() {
  const o = window.screen && window.screen.orientation;
  return (((o ? o.angle : window.orientation) || 0) % 360 + 360) % 360;
}
// Приложение для Android (Capacitor): модули доступны через Capacitor.Plugins, в браузере их нет
export const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
export const plug = name => (native && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;
// Закрепляем основную альбомную ориентацию: в приложении — нативно (кадр поворачивать не нужно),
// в браузере на Android — через полноэкранный режим, если он поддерживает блокировку.
export async function lockScreen() {
  const so = plug('ScreenOrientation');
  if (so) { try { await so.lock({ orientation: 'landscape-primary' }); } catch (e) { } return; }
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    await screen.orientation.lock('landscape-primary');
  } catch (e) { }
}
