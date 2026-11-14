// Doorway Field v1.1.1 — PUBLISH config (config.publish.js -> Pages repo config.js; never in Drive). Owner only; REPS added later. Was: PLACEHOLDERS ONLY: no secrets, no Drive/Sheet/Script IDs in source.
// Kim fills the blanks at publish time from the deploy env (see MANIFEST.json "config_fill"). Public tile URLs only.
window.DF_CONFIG = Object.assign({
  VERSION: '1.1.1',
  ORG_ID: 'doorway',
  OWNER_DOMAIN: 'doorwaypartners.com',
  OWNER_EMAILS: ['cristian@doorwaypartners.com'],            // fill at publish: owner allow-list (UI gate only; the API re-checks every owner action)
  API_URL: '',                 // fill at publish: Doorway Field API web-app URL. Blank = local-only (offline queue keeps everything)
  GOOGLE_CLIENT_ID: '',        // fill at publish: OAuth web client for Google sign-in. Blank = dev email sign-in
  REPS: [],                    // [{ email, name }] shown in turf assignment; the API list wins when connected
  FIXTURE_URL: '',             // tests/dev only: JSON fixture loaded into an empty device
  IMAGERY: 'esri',             // 'esri' (sharper; terms check before live) | 'usgs' (free US gov NAIP, ~1 m)
  DEFAULT_MODE: 'hybrid',      // street | hybrid | satellite
  FLUSH_EVERY_MS: 60000,
  UNDO_MS: 5000,
  SOLD_FIELDS: [               // owner sign-off 2026-11-14: exactly these 4
    { key: 'customer_name', label: 'Customer Name', type: 'text', required: true },
    { key: 'speed_tier', label: 'Speed Tier', type: 'text', required: true },
    { key: 'phone_email', label: 'Phone / Email', type: 'text', required: true },
    { key: 'install_date', label: 'Install Date', type: 'date', required: false }
  ],
  TILES: {
    esri: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    esriAttr: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    usgs: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    usgsAttr: 'USDA, USGS The National Map: Orthoimagery',
    streetStyle: 'https://tiles.openfreemap.org/styles/liberty',
    vector: 'https://tiles.openfreemap.org/planet',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    font: 'Noto Sans Regular',
    vectorAttr: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }
}, window.DF_CONFIG_OVERRIDE || {});
