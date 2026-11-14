/**
 * 敏感值掩码：前 4 + 后 4，短的更严格。前后端共用同一套规则。
 */
export function maskKey(value) {
  const text = String(value || '');
  if (text.length === 0) return '';
  if (text.length >= 8) return text.slice(0, 4) + '…' + text.slice(-4);
  if (text.length >= 5) return text.slice(0, 1) + '…' + text.slice(-1);
  return '…';
}
