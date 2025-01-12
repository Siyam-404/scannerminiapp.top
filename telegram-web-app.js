// WebView
(function () {
  var eventHandlers = {};

  var locationHash = '';
  try {
    locationHash = location.hash.toString();
  } catch (e) {}

  var initParams = urlParseHashParams(locationHash);
  var storedParams = sessionStorageGet('initParams');
  if (storedParams) {
    for (var key in storedParams) {
      if (typeof initParams[key] === 'undefined') {
        initParams[key] = storedParams[key];
      }
    }
  }
  sessionStorageSet('initParams', initParams);

  var isIframe = false, iFrameStyle;
  try {
    isIframe = (window.parent != null && window != window.parent);
    if (isIframe) {
      window.addEventListener('message', function (event) {
        if (event.source !== window.parent) return;
        try {
          var dataParsed = JSON.parse(event.data);
        } catch (e) {
          return;
        }
        if (!dataParsed || !dataParsed.eventType) {
          return;
        }
        if (dataParsed.eventType == 'set_custom_style') {
          if (event.origin === 'https://web.telegram.org') {
            iFrameStyle.innerHTML = dataParsed.eventData;
          }
        } else if (dataParsed.eventType == 'reload_iframe') {
          try {
            window.parent.postMessage(JSON.stringify({eventType: 'iframe_will_reload'}), '*');
          } catch (e) {}
          location.reload();
        } else {
          receiveEvent(dataParsed.eventType, dataParsed.eventData);
        }
      });
      iFrameStyle = document.createElement('style');
      document.head.appendChild(iFrameStyle);
      try {
        window.parent.postMessage(JSON.stringify({eventType: 'iframe_ready', eventData: {reload_supported: true}}), '*');
      } catch (e) {}
    }
  } catch (e) {}

  function urlSafeDecode(urlencoded) {
    try {
      urlencoded = urlencoded.replace(/\+/g, '%20');
      return decodeURIComponent(urlencoded);
    } catch (e) {
      return urlencoded;
    }
  }

  function urlParseHashParams(locationHash) {
    locationHash = locationHash.replace(/^#/, '');
    var params = {};
    if (!locationHash.length) {
      return params;
    }
    if (locationHash.indexOf('=') < 0 && locationHash.indexOf('?') < 0) {
      params._path = urlSafeDecode(locationHash);
      return params;
    }
    var qIndex = locationHash.indexOf('?');
    if (qIndex >= 0) {
      var pathParam = locationHash.substr(0, qIndex);
      params._path = urlSafeDecode(pathParam);
      locationHash = locationHash.substr(qIndex + 1);
    }
    var query_params = urlParseQueryString(locationHash);
    for (var k in query_params) {
      params[k] = query_params[k];
    }
    return params;
  }

  function urlParseQueryString(queryString) {
    var params = {};
    if (!queryString.length) {
      return params;
    }
    var queryStringParams = queryString.split('&');
    var i, param, paramName, paramValue;
    for (i = 0; i < queryStringParams.length; i++) {
      param = queryStringParams[i].split('=');
      paramName = urlSafeDecode(param[0]);
      paramValue = param[1] == null ? null : urlSafeDecode(param[1]);
      params[paramName] = paramValue;
    }
    return params;
  }

  // Telegram apps will implement this logic to add service params (e.g. tgShareScoreUrl) to game URL
  function urlAppendHashParams(url, addHash) {
    // url looks like 'https://game.com/path?query=1#hash'
    // addHash looks like 'tgShareScoreUrl=' + encodeURIComponent('tgb://share_game_score?hash=very_long_hash123')

    var ind = url.indexOf('#');
    if (ind < 0) {
      // https://game.com/path -> https://game.com/path#tgShareScoreUrl=etc
      return url + '#' + addHash;
    }
    var curHash = url.substr(ind + 1);
    if (curHash.indexOf('=') >= 0 || curHash.indexOf('?') >= 0) {
      // https://game.com/#hash=1 -> https://game.com/#hash=1&tgShareScoreUrl=etc
      // https://game.com/#path?query -> https://game.com/#path?query&tgShareScoreUrl=etc
      return url + '&' + addHash;
    }
    // https://game.com/#hash -> https://game.com/#hash?tgShareScoreUrl=etc
    if (curHash.length > 0) {
      return url + '?' + addHash;
    }
    // https://game.com/# -> https://game.com/#tgShareScoreUrl=etc
    return url + addHash;
  }

  function postEvent(eventType, callback, eventData) {
    if (!callback) {
      callback = function () {};
    }
    if (eventData === undefined) {
      eventData = '';
    }
    console.log('[Telegram.WebView] > postEvent', eventType, eventData);

    if (window.TelegramWebviewProxy !== undefined) {
      TelegramWebviewProxy.postEvent(eventType, JSON.stringify(eventData));
      callback();
    }
    else if (window.external && 'notify' in window.external) {
      window.external.notify(JSON.stringify({eventType: eventType, eventData: eventData}));
      callback();
    }
    else if (isIframe) {
      try {
        var trustedTarget = 'https://web.telegram.org';
        // For now we don't restrict target, for testing purposes
        trustedTarget = '*';
        window.parent.postMessage(JSON.stringify({eventType: eventType, eventData: eventData}), trustedTarget);
        callback();
      } catch (e) {
        callback(e);
      }
    }
    else {
      callback({notAvailable: true});
    }
  };

  function receiveEvent(eventType, eventData) {
    console.log('[Telegram.WebView] < receiveEvent', eventType, eventData);
    callEventCallbacks(eventType, function(callback) {
      callback(eventType, eventData);
    });
  }

  function callEventCallbacks(eventType, func) {
    var curEventHandlers = eventHandlers[eventType];
    if (curEventHandlers === undefined ||
        !curEventHandlers.length) {
      return;
    }
    for (var i = 0; i < curEventHandlers.length; i++) {
      try {
        func(curEventHandlers[i]);
      } catch (e) {}
    }
  }

  function onEvent(eventType, callback) {
    if (eventHandlers[eventType] === undefined) {
      eventHandlers[eventType] = [];
    }
    var index = eventHandlers[eventType].indexOf(callback);
    if (index === -1) {
      eventHandlers[eventType].push(callback);
    }
  };

  function offEvent(eventType, callback) {
    if (eventHandlers[eventType] === undefined) {
      return;
    }
    var index = eventHandlers[eventType].indexOf(callback);
    if (index === -1) {
      return;
    }
    eventHandlers[eventType].splice(index, 1);
  };

  function openProtoUrl(url) {
    if (!url.match(/^(web\+)?tgb?:\/\/./)) {
      return false;
    }
    var useIframe = navigator.userAgent.match(/iOS|iPhone OS|iPhone|iPod|iPad/i) ? true : false;
    if (useIframe) {
      var iframeContEl = document.getElementById('tgme_frame_cont') || document.body;
      var iframeEl = document.createElement('iframe');
      iframeContEl.appendChild(iframeEl);
      var pageHidden = false;
      var enableHidden = function () {
        pageHidden = true;
      };
      window.addEventListener('pagehide', enableHidden, false);
      window.addEventListener('blur', enableHidden, false);
      if (iframeEl !== null) {
        iframeEl.src = url;
      }
      setTimeout(function() {
        if (!pageHidden) {
          window.location = url;
        }
        window.removeEventListener('pagehide', enableHidden, false);
        window.removeEventListener('blur', enableHidden, false);
      }, 2000);
    }
    else {
      window.location = url;
    }
    return true;
  }

  function sessionStorageSet(key, value) {
    try {
      window.sessionStorage.setItem('__telegram__' + key, JSON.stringify(value));
      return true;
    } catch(e) {}
    return false;
  }
  function sessionStorageGet(key) {
    try {
      return JSON.parse(window.sessionStorage.getItem('__telegram__' + key));
    } catch(e) {}
    return null;
  }

  if (!window.Telegram) {
    window.Telegram = {};
  }
  window.Telegram.WebView = {
    initParams: initParams,
    isIframe: isIframe,
    onEvent: onEvent,
    offEvent: offEvent,
    postEvent: postEvent,
    receiveEvent: receiveEvent,
    callEventCallbacks: callEventCallbacks
  };

  window.Telegram.Utils = {
    urlSafeDecode: urlSafeDecode,
    urlParseQueryString: urlParseQueryString,
    urlParseHashParams: urlParseHashParams,
    urlAppendHashParams: urlAppendHashParams,
    sessionStorageSet: sessionStorageSet,
    sessionStorageGet: sessionStorageGet
  };

  // For Windows Phone app
  window.TelegramGameProxy_receiveEvent = receiveEvent;

  // App backward compatibility
  window.TelegramGameProxy = {
    receiveEvent: receiveEvent
  };
})();

// WebApp
(function () {
  var Utils = window.Telegram.Utils;
  var WebView = window.Telegram.WebView;
  var initParams = WebView.initParams;
  var isIframe = WebView.isIframe;

  var WebApp = {};
  var webAppInitData = '', webAppInitDataUnsafe = {};
  var themeParams = {}, colorScheme = 'light';
  var webAppVersion = '6.0';
  var webAppPlatform = 'unknown';
  var webAppIsActive = true;
  var webAppIsFullscreen = false;
  var webAppIsOrientationLocked = false;
  var webAppBackgroundColor = 'bg_color';
  var webAppHeaderColorKey = 'bg_color';
  var webAppHeaderColor = null;

  if (initParams.tgWebAppData && initParams.tgWebAppData.length) {
    webAppInitData = initParams.tgWebAppData;
    webAppInitDataUnsafe = Utils.urlParseQueryString(webAppInitData);
    for (var key in webAppInitDataUnsafe) {
      var val = webAppInitDataUnsafe[key];
      try {
        if (val.substr(0, 1) == '{' && val.substr(-1) == '}' ||
            val.substr(0, 1) == '[' && val.substr(-1) == ']') {
          webAppInitDataUnsafe[key] = JSON.parse(val);
        }
      } catch (e) {}
    }
  }
  var stored_theme_params = Utils.sessionStorageGet('themeParams');
  if (initParams.tgWebAppThemeParams && initParams.tgWebAppThemeParams.length) {
    var themeParamsRaw = initParams.tgWebAppThemeParams;
    try {
      var theme_params = JSON.parse(themeParamsRaw);
      if (theme_params) {
        setThemeParams(theme_params);
      }
    } catch (e) {}
  }
  if (stored_theme_params) {
    setThemeParams(stored_theme_params);
  }
  var stored_def_colors = Utils.sessionStorageGet('defaultColors');
  if (initParams.tgWebAppDefaultColors && initParams.tgWebAppDefaultColors.length) {
    var defColorsRaw = initParams.tgWebAppDefaultColors;
    try {
      var def_colors = JSON.parse(defColorsRaw);
      if (def_colors) {
        setDefaultColors(def_colors);
      }
    } catch (e) {}
  }
  if (stored_def_colors) {
    setDefaultColors(stored_def_colors);
  }
  if (initParams.tgWebAppVersion) {
    webAppVersion = initParams.tgWebAppVersion;
  }
  if (initParams.tgWebAppPlatform) {
    webAppPlatform = initParams.tgWebAppPlatform;
  }

  var stored_fullscreen = Utils.sessionStorageGet('isFullscreen');
  if (initParams.tgWebAppFullscreen) {
    setFullscreen(true);
  }
  if (stored_fullscreen) {
    setFullscreen(stored_fullscreen == 'yes');
  }

  var stored_orientation_lock = Utils.sessionStorageGet('isOrientationLocked');
  if (stored_orientation_lock) {
    setOrientationLock(stored_orientation_lock == 'yes');
  }

  function onThemeChanged(eventType, eventData) {
    if (eventData.theme_params) {
      setThemeParams(eventData.theme_params);
      window.Telegram.WebApp.MainButton.setParams({});
      window.Telegram.WebApp.SecondaryButton.setParams({});
      updateHeaderColor();
      updateBackgroundColor();
      updateBottomBarColor();
      receiveWebViewEvent('themeChanged');
    }
  }

  var lastWindowHeight = window.innerHeight;
  function onViewportChanged(eventType, eventData) {
    if (eventData.height) {
      window.removeEventListener('resize', onWindowResize);
      setViewportHeight(eventData);
    }
  }

  function onWindowResize(e) {
    if (lastWindowHeight != window.innerHeight) {
      lastWindowHeight = window.innerHeight;
      receiveWebViewEvent('viewportChanged', {
        isStateStable: true
      });
    }
  }

  function onSafeAreaChanged(eventType, eventData) {
    if (eventData) {
      setSafeAreaInset(eventData);
    }
  }
  function onContentSafeAreaChanged(eventType, eventData) {
    if (eventData) {
      setContentSafeAreaInset(eventData);
    }
  }

  function onVisibilityChanged(eventType, eventData) {
    if (eventData.is_visible) {
      webAppIsActive = true;
      receiveWebViewEvent('activated');
    } else {
      webAppIsActive = false;
      receiveWebViewEvent('deactivated');
    }
  }

  function linkHandler(e) {
    if (e.metaKey || e.ctrlKey) return;
    var el = e.target;
    while (el.tagName != 'A' && el.parentNode) {
      el = el.parentNode;
    }
    if (el.tagName == 'A' &&
        el.target != '_blank' &&
        (el.protocol == 'http:' || el.protocol == 'https:') &&
        el.hostname == 't.me') {
      WebApp.openTgLink(el.href);
      e.preventDefault();
    }
  }

  function strTrim(str) {
    return str.toString().replace(/^\s+|\s+$/g, '');
  }

  function receiveWebViewEvent(eventType) {
    var args = Array.prototype.slice.call(arguments);
    eventType = args.shift();
    WebView.callEventCallbacks('webview:' + eventType, function(callback) {
      callback.apply(WebApp, args);
    });
  }

  function onWebViewEvent(eventType, callback) {
    WebView.onEvent('webview:' + eventType, callback);
  };

  function offWebViewEvent(eventType, callback) {
    WebView.offEvent('webview:' + eventType, callback);
  };

  function setCssProperty(name, value) {
    var root = document.documentElement;
    if (root && root.style && root.style.setProperty) {
      root.style.setProperty('--tg-' + name, value);
    }
  }

  function setFullscreen(is_fullscreen) {
    webAppIsFullscreen = !!is_fullscreen;
    Utils.sessionStorageSet('isFullscreen', webAppIsFullscreen ? 'yes' : 'no');
  }

  function setOrientationLock(is_locked) {
    webAppIsOrientationLocked = !!is_locked;
    Utils.sessionStorageSet('isOrientationLocked', webAppIsOrientationLocked ? 'yes' : 'no');
  }

  function setThemeParams(theme_params) {
    // temp iOS fix
    if (theme_params.bg_color == '#1c1c1d' &&
        theme_params.bg_color == theme_params.secondary_bg_color) {
      theme_params.secondary_bg_color = '#2c2c2e';
    }
    var color;
    for (var key in theme_params) {
      if (color = parseColorToHex(theme_params[key])) {
        themeParams[key] = color;
        if (key == 'bg_color') {
          colorScheme = isColorDark(color) ? 'dark' : 'light'
          setCssProperty('color-scheme', colorScheme);
        }
        key = 'theme-' + key.split('_').join('-');
        setCssProperty(key, color);
      }
    }
    Utils.sessionStorageSet('themeParams', themeParams);
  }

  function setDefaultColors(def_colors) {
    if (colorScheme == 'dark') {
      if (def_colors.bg_dark_color) {
        webAppBackgroundColor = def_colors.bg_dark_color;
      }
      if (def_colors.header_dark_color) {
        webAppHeaderColorKey = null;
        webAppHeaderColor = def_colors.header_dark_color;
      }
    } else {
      if (def_colors.bg_color) {
        webAppBackgroundColor = def_colors.bg_color;
      }
      if (def_colors.header_color) {
        webAppHeaderColorKey = null;
        webAppHeaderColor = def_colors.header_color;
      }
    }
    Utils.sessionStorageSet('defaultColors', def_colors);
  }

  var webAppCallbacks = {};
  function generateCallbackId(len) {
    var tries = 100;
    while (--tries) {
      var id = '', chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', chars_len = chars.length;
      for (var i = 0; i < len; i++) {
        id += chars[Math.floor(Math.random() * chars_len)];
      }
      if (!webAppCallbacks[id]) {
        webAppCallbacks[id] = {};
        return id;
      }
    }
    throw Error('WebAppCallbackIdGenerateFailed');
  }

  var viewportHeight = false, viewportStableHeight = false, isExpanded = true;
  function setViewportHeight(data) {
    if (typeof data !== 'undefined') {
      isExpanded = !!data.is_expanded;
      viewportHeight = data.height;
      if (data.is_state_stable) {
        viewportStableHeight = data.height;
      }
      receiveWebViewEvent('viewportChanged', {
        isStateStable: !!data.is_state_stable
      });
    }
    var height, stable_height;
    if (viewportHeight !== false) {
      height = (viewportHeight - bottomBarHeight) + 'px';
    } else {
      height = bottomBarHeight ? 'calc(100vh - ' + bottomBarHeight + 'px)' : '100vh';
    }
    if (viewportStableHeight !== false) {
      stable_height = (viewportStableHeight - bottomBarHeight) + 'px';
    } else {
      stable_height = bottomBarHeight ? 'calc(100vh - ' + bottomBarHeight + 'px)' : '100vh';
    }
    setCssProperty('viewport-height', height);
    setCssProperty('viewport-stable-height', stable_height);
  }

  var safeAreaInset = {top: 0, bottom: 0, left: 0, right: 0};
  function setSafeAreaInset(data) {
    if (typeof data !== 'undefined') {
      if (typeof data.top !== 'undefined') {
        safeAreaInset.top = data.top;
      }
      if (typeof data.bottom !== 'undefined') {
        safeAreaInset.bottom = data.bottom;
      }
      if (typeof data.left !== 'undefined') {
        safeAreaInset.left = data.left;
      }
      if (typeof data.right !== 'undefined') {
        safeAreaInset.right = data.right;
      }
      receiveWebViewEvent('safeAreaChanged');
    }
    setCssProperty('safe-area-inset-top', safeAreaInset.top + 'px');
    setCssProperty('safe-area-inset-bottom', safeAreaInset.bottom + 'px');
    setCssProperty('safe-area-inset-left', safeAreaInset.left + 'px');
    setCssProperty('safe-area-inset-right', safeAreaInset.right + 'px');
  }

  var contentSafeAreaInset = {top: 0, bottom: 0, left: 0, right: 0};
  function setContentSafeAreaInset(data) {
    if (typeof data !== 'undefined') {
      if (typeof data.top !== 'undefined') {
        contentSafeAreaInset.top = data.top;
      }
      if (typeof data.bottom !== 'undefined') {
        contentSafeAreaInset.bottom = data.bottom;
      }
      if (typeof data.left !== 'undefined') {
        contentSafeAreaInset.left = data.left;
      }
      if (typeof data.right !== 'undefined') {
        contentSafeAreaInset.right = data.right;
      }
      receiveWebViewEvent('contentSafeAreaChanged');
    }
    setCssProperty('content-safe-area-inset-top', contentSafeAreaInset.top + 'px');
    setCssProperty('content-safe-area-inset-bottom', contentSafeAreaInset.bottom + 'px');
    setCssProperty('content-safe-area-inset-left', contentSafeAreaInset.left + 'px');
    setCssProperty('content-safe-area-inset-right', contentSafeAreaInset.right + 'px');
  }

  var isClosingConfirmationEnabled = false;
  function setClosingConfirmation(need_confirmation) {
    if (!versionAtLeast('6.2')) {
      console.warn('[Telegram.WebApp] Closing confirmation is not supported in version ' + webAppVersion);
      return;
    }
    isClosingConfirmationEnabled = !!need_confirmation;
    WebView.postEvent('web_app_setup_closing_behavior', false, {need_confirmation: isClosingConfirmationEnabled});
  }

  var isVerticalSwipesEnabled = true;
  function toggleVerticalSwipes(enable_swipes) {
    if (!versionAtLeast('7.7')) {
      console.warn('[Telegram.WebApp] Changing swipes behavior is not supported in version ' + webAppVersion);
      return;
    }
    isVerticalSwipesEnabled = !!enable_swipes;
    WebView.postEvent('web_app_setup_swipe_behavior', false, {allow_vertical_swipe: isVerticalSwipesEnabled});
  }

  function onFullscreenChanged(eventType, eventData) {
    setFullscreen(eventData.is_fullscreen);
    receiveWebViewEvent('fullscreenChanged');
  }
  function onFullscreenFailed(eventType, eventData) {
    if (eventData.error == 'ALREADY_FULLSCREEN' && !webAppIsFullscreen) {
      setFullscreen(true);
    }
    receiveWebViewEvent('fullscreenFailed', {
      error: eventData.error
    });
  }

  function toggleOrientationLock(locked) {
    if (!versionAtLeast('8.0')) {
      console.warn('[Telegram.WebApp] Orientation locking is not supported in version ' + webAppVersion);
      return;
    }
    setOrientationLock(locked);
    WebV
