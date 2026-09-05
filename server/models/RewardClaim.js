const mongoose = require('mongoose');
const RewardClaimSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind: { type: String, enum: ['daily-quiz','rewarded-ad'], required: true },
  key: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  provider: { type: String, default: '' },
  providerReceipt: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});
RewardClaimSchema.index({ user: 1, kind: 1, key: 1 }, { unique: true });
module.exports = mongoose.model('RewardClaim', RewardClaimSchema);
