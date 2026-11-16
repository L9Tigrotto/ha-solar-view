"""Names shared by the solar_view files."""
DOMAIN = "solar_view"
CONF_SOC = "soc_entity"              # battery state of charge sensor, optional
CONF_EXPORT_LIMIT = "export_limit_kw"  # empty: unlimited, 0: no export
CONF_MODEL = "weather_model"         # Open-Meteo model name, options only
STAT_ID = f"{DOMAIN}:sun_forecast"   # the day-ahead sun forecast, kept as long-term statistics
STALE_AFTER_HOURS = 12               # last good weather is reused this long, then a repair issue opens
