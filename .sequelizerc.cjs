const path = require("path");

// Register ts-node for TypeScript migration support
require('ts-node').register({
  compilerOptions: {
    module: 'commonjs',
  },
  transpileOnly: true,
});

module.exports = {
  config: path.resolve(__dirname, "sequelize.config.cjs"),
  modelsPath: path.resolve(__dirname, "src/models"),
  migrationsPath: path.resolve(__dirname, "migrations"),
  seedersPath: path.resolve(__dirname, "src/seeders"),
};
