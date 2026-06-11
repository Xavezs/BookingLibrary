let appPromise;

module.exports = async function handler(req, res) {
  if (!appPromise) {
    appPromise = import('../server/src/index.js').then((module) => module.default);
  }
  const app = await appPromise;
  return app(req, res);
};
