const { defineContract, field, model } = require('@internal/mongo/contract-builder');

const User = model('User', { collection: 'users', fields: { _id: field.objectId() } });

module.exports = defineContract({ models: { User } });
