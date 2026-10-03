function relativeTime(then, now) {
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const future = seconds < 0;
  const suffix = future ? 'from now' : 'ago';
  if (abs < 45) return 'just now';
  if (abs < 90) return future ? 'in 1 minute' : '1 minute ago';
  const minutes = Math.round(abs / 60);
  if (minutes < 45) return future ? `in ${minutes} minutes` : `${minutes} minutes ago`;
  if (minutes < 90) return future ? 'in 1 hour' : '1 hour ago';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours} hours` : `${hours} hours ago`;
  if (hours < 36) return future ? 'in 1 day' : '1 day ago';
  const days = Math.round(hours / 24);
  return future ? `in ${days} days` : `${days} days ${suffix === 'ago' ? 'ago' : ''}`.replace(/\s+$/, '');
}

export function describeFreshness({ lastUpdatedAt, uploadNotice, now = new Date() } = {}) {
  if (uploadNotice) return uploadNotice;
  if (!lastUpdatedAt) return 'Historical data only';
  const then = new Date(lastUpdatedAt);
  if (Number.isNaN(then.getTime())) return 'Historical data only';
  const absolute = then.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `Data updated ${relativeTime(then, now)} (${absolute})`;
}
