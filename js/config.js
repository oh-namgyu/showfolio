// =============================================================================
//  showfolio — THE ONE FILE YOU EDIT
// =============================================================================
//
//  Fork this repo, change the values below, deploy the folder as a static site.
//  There is no build step and no server: every other file can stay untouched.
//
//  After changing `username`, regenerate the offline snapshot so the first
//  paint shows *your* repos instantly:
//
//      npm run snapshot     # writes data/snapshot.json — commit that file
//
//  The snapshot is optional. Without it the page still works: it shows a
//  loading skeleton and fetches live from the GitHub API instead.
//
// =============================================================================

export const config = {
  // ---------------------------------------------------------------------------
  // username — the GitHub account whose PUBLIC repos are shown.
  // This is the only required field. Everything else has a sane default.
  // ---------------------------------------------------------------------------
  username: 'oh-namgyu',

  // ---------------------------------------------------------------------------
  // exclude — repo names to hide, matched exactly and case-insensitively.
  // Forks and archived repos are already dropped automatically, so this is for
  // things like scratch repos or your profile README container.
  //   e.g. exclude: ['dotfiles', 'oh-namgyu']
  // ---------------------------------------------------------------------------
  exclude: [],

  // ---------------------------------------------------------------------------
  // pinned — repo names to feature in a separate section above the main grid,
  // in exactly this order. Names that do not exist are ignored silently, so an
  // out-of-date pin never breaks the page.
  // ---------------------------------------------------------------------------
  pinned: ['cc-anatomy', 'pipeline-anatomy', 'kids-coloring'],

  // ---------------------------------------------------------------------------
  // demoOverrides — live-demo URLs, keyed by repo name.
  //
  // The "Demo" button normally uses the repo's GitHub `homepage` field, which
  // you can set once per repo in GitHub's UI (Settings → About → Website).
  // Use this map when you cannot or do not want to set `homepage`; entries here
  // win over `homepage`. Only http:// and https:// URLs are accepted.
  //   e.g. demoOverrides: { 'kids-coloring': 'https://example.vercel.app' }
  // ---------------------------------------------------------------------------
  demoOverrides: {},
};

export default config;
