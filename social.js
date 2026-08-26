'use strict';

function parseSocialLink(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let platform = null;
  if (host === 'facebook.com' || host === 'fb.watch' || host.endsWith('.facebook.com')) {
    platform = 'facebook';
  } else if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com')) {
    platform = 'x';
  } else {
    return null;
  }

  let postId = '';
  if (platform === 'x') {
    const status = url.pathname.match(/\/status\/([0-9]+)/i);
    postId = status ? status[1] : '';
  } else {
    const pathId = url.pathname.match(/\/(?:videos?|reel|reels|posts|story)\/([0-9]+)/i);
    const queryId = url.searchParams.get('v') || url.searchParams.get('video_id') || '';
    postId = pathId ? pathId[1] : queryId;
  }

  return {
    platform,
    postId,
    url: url.toString(),
  };
}

module.exports = { parseSocialLink };
