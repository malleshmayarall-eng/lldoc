import assert from 'node:assert/strict';

function formatStatusLabel(status) {
  return (status || 'draft')
    .replace(/_/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

assert.equal(formatStatusLabel('under_review'), 'Under Review');
assert.equal(formatStatusLabel(''), 'Draft');
assert.equal(formatStatusLabel(undefined), 'Draft');
assert.equal(formatDateTime(null), '—');
assert.match(formatDateTime('2026-03-10T15:30:00Z'), /Mar/);
assert.match(formatDateTime('2026-03-10T15:30:00Z'), /2026/);

console.log('documentsPageHelpersCheck: ok');
