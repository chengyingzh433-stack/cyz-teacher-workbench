// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE

var ICON = (function () {
  function i(d, extra) {
    return (
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
      (extra || '') +
      '>' +
      d +
      '</svg>'
    );
  }
  return {
    room: i(
      '<rect x="3" y="4" width="18" height="6" rx="1.5"/><path d="M5 14h4M15 14h4M5 18h4M15 18h4"/>'
    ),
    users: i(
      '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17 14.6c2 .5 3.2 2 3.6 4.4"/>'
    ),
    edit: i('<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/>'),
    chart: i('<path d="M4 20V4M4 20h16"/><path d="M8 16l3.5-4 3 2.5L19 8"/>'),
    spark: i(
      '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'
    ),
    gear: i(
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'
    ),
    search: i(
      '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
      ' width="14" height="14" style="color:#9a9a97"'
    ),
    plus: i('<path d="M12 5v14M5 12h14"/>'),
    x: i('<path d="M6 6l12 12M18 6L6 18"/>'),
    dice: i(
      '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/>'
    ),
    zin: i('<path d="M12 6v12M6 12h12"/>'),
    zout: i('<path d="M6 12h12"/>'),
    unfull: i('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
    fit: i('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    lock: i(
      '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
      ' width="14" height="14"'
    ),
    down: i('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
    up: i('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'),
    trash: i('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>'),
    copy: i(
      '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'
    ),
    doc: i('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'),
    check: i('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    cake: i(
      '<path d="M4 20h16M5 20v-7h14v7"/><path d="M5 15.5c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0M12 13V9.5"/><path d="M12 6.5c.9-.6.9-1.8 0-2.6-.9.8-.9 2 0 2.6z"/>'
    ),
    send: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    stop: '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
    side: i('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/>'),
    print: i(
      '<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1"/>'
    ),
    userplus: i(
      '<circle cx="10" cy="8" r="3.4"/><path d="M3.5 19.5c.7-3.2 3.2-5 6.5-5s5.8 1.8 6.5 5M19 8v6M16 11h6"/>'
    ),
    back: i('<path d="M15 5l-7 7 7 7"/>'),
    refresh: i('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>'),
    eye: i(
      '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
    ),
    shuffle: i(
      '<path d="M4 17h3l9-10h4M4 7h3l2.5 2.8M14.5 14.2L16 17h4M18 4l3 3-3 3M18 14l3 3-3 3"/>'
    ),
    star: i(
      '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>'
    ),
    link: i(
      '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
    )
  };
})();

export { ICON };
