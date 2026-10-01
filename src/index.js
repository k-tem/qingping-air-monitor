'use strict';

const { QingpingPlatform } = require('./platform');

module.exports = (api) => {
  api.registerPlatform('Qingping CGS2', QingpingPlatform);
};
