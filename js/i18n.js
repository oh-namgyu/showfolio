// i18n.js — every user-facing string in the shell, in both locales.
// Repo names, descriptions and Korean summaries are data, not UI text; they
// come from the API and are written with textContent by cards.js.

export const LOCALE_KEY = 'showfolio:locale';

export const TEXT = {
  en: {
    all: 'All',
    pinned: 'Pinned',
    repos: 'Repositories',
    empty: 'Nothing matches this filter.',
    sub: 'on GitHub',
    live: 'updated live',
    cached: 'from cache',
    added: (n) => `${n} new ${n === 1 ? 'repo' : 'repos'} since the snapshot`,
    truncated: 'showing the first 200 repositories',
    ratelimited: 'GitHub’s hourly limit for anonymous visitors is reached — showing the last saved copy.',
    offline: 'Could not reach GitHub — showing the last saved copy.',
    blocked: (user) => `Could not load repositories for “${user}”, and there is no saved copy to fall back on. GitHub limits anonymous visitors to 60 requests an hour; try again later.`,
  },
  ko: {
    all: '전체',
    pinned: '고정',
    repos: '저장소',
    empty: '이 필터에 해당하는 저장소가 없습니다.',
    sub: 'GitHub 프로필',
    live: '실시간 갱신됨',
    cached: '캐시에서 불러옴',
    added: (n) => `스냅샷 이후 새 저장소 ${n}개`,
    truncated: '최근 200개만 표시합니다',
    ratelimited: 'GitHub 익명 요청 한도에 도달했습니다 — 마지막으로 저장된 목록을 보여줍니다.',
    offline: 'GitHub에 연결하지 못했습니다 — 마지막으로 저장된 목록을 보여줍니다.',
    blocked: (user) => `“${user}” 저장소 목록을 불러오지 못했고, 대체할 저장본도 없습니다. GitHub은 익명 요청을 시간당 60회로 제한합니다. 잠시 후 다시 시도해 주세요.`,
  },
};

/** Normalise anything to a supported locale. */
export const normalizeLocale = (value) => (value === 'ko' ? 'ko' : 'en');

/** Read the remembered locale; storage failures fall back to English. */
export function readLocale() {
  try {
    return normalizeLocale(globalThis.localStorage?.getItem(LOCALE_KEY));
  } catch {
    return 'en';
  }
}

/** Remember the locale. Private mode simply will not persist it. */
export function writeLocale(locale) {
  try {
    globalThis.localStorage?.setItem(LOCALE_KEY, normalizeLocale(locale));
  } catch { /* ignore */ }
}
