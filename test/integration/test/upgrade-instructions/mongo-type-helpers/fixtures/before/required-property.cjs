const fieldProp = require('@internal/mongo/contract-builder').field;
const { model } = require('@internal/mongo/contract-builder');

module.exports = model('Doc', { collection: 'docs', fields: { _id: fieldProp.objectId() } });
