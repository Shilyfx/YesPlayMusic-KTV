function createHostIntersectionHandler(host, onChange) {
  return entries => {
    let hostEntry = null;
    for (const entry of entries) {
      if (entry.target === host) hostEntry = entry;
    }
    if (hostEntry) onChange(Boolean(hostEntry.isIntersecting));
  };
}

module.exports = { createHostIntersectionHandler };
