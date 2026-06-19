function createWikiState() {
  let searchOpen = $state(false);

  return {
    get searchOpen() {
      return searchOpen;
    },
    set searchOpen(v: boolean) {
      searchOpen = v;
    },
    openSearch() {
      searchOpen = true;
    },
    closeSearch() {
      searchOpen = false;
    }
  };
}

export const wikiState = createWikiState();
