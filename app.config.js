// app.config.js
module.exports = ({ config }) => ({
  ...config,
  icon: './assets/images/logo.png',
  android: {
    ...config.android,
    adaptiveIcon: {
      ...config.android?.adaptiveIcon,
      foregroundImage: './assets/images/logo.png',
    },
  },
  web: {
    ...config.web,
    favicon: './assets/images/logo.png',
  },
  plugins: config.plugins?.map((plugin) => {
    if (Array.isArray(plugin) && plugin[0] === 'expo-splash-screen') {
      return [
        plugin[0],
        {
          ...plugin[1],
          image: './assets/images/logo.png',
        },
      ];
    }
    return plugin;
  }),
});
