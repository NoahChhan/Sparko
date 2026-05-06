export function formatTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
