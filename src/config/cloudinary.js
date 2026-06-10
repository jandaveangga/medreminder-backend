const { v2: cloudinary } = require('cloudinary');
const logger = require('../utils/logger');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

logger.info('Cloudinary configured for cloud: ' + process.env.CLOUDINARY_CLOUD_NAME);

module.exports = cloudinary;
