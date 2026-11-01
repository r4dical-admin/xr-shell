'use strict';

const query = new URLSearchParams(location.search);
const measurementId = query.get('id');
const clientId = query.get('clientId');
if (/^G-[A-Z0-9]+$/.test(measurementId || '') && clientId && clientId.length < 100) {
  window.dataLayer = [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, {
    client_id: clientId,
    send_page_view: false,
    // Do not let GA infer the local file:// path of the packaged app.
    page_location: 'https://xr-shell.invalid/app',
    page_title: 'XR Shell',
    page_referrer: '',
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });
  window.xrAnalyticsSend = (name, params) => {
    if (!['xr_install', 'xr_app_open', 'xr_active_time'].includes(name)) return;
    window.gtag('event', name, { send_to: measurementId, ...params });
  };
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.append(script);
}
