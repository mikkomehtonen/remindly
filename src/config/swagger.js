const swaggerJsdoc = require('swagger-jsdoc');
const { VALID_CATEGORIES } = require('./categories');

// Single source of truth for category enums: the spec's category parameters and
// schema properties get their enum values from VALID_CATEGORIES here. JSDoc in the
// route files only declares WHERE enums exist; the values live only in
// src/config/categories.js and can never drift.
function applyCategoryEnums(node) {
  if (Array.isArray(node)) {
    node.forEach(applyCategoryEnums);
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (node.name === 'category' && node.schema) {
    node.schema.enum = [...VALID_CATEGORIES];
  }
  if (node.properties && node.properties.category) {
    node.properties.category.enum = [...VALID_CATEGORIES];
  }
  Object.values(node).forEach(applyCategoryEnums);
}

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Remindly API',
      version: '1.0.0',
      description: 'Event reminder API with admin management',
    },
    servers: [
      {
        url: process.env.SERVER_URL || 'http://localhost:3000',
        description: 'Local development server',
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
        },
      },
    },
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);
applyCategoryEnums(swaggerSpec);

module.exports = swaggerSpec;
