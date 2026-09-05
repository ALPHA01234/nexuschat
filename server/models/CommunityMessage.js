const mongoose = require('mongoose');

const CommunityMessageSchema = new mongoose.Schema({
  community: { type: mongoose.Schema.Types.ObjectId, ref: 'Community', required: true, index: true },
  channelId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, maxlength: 4000 },
  createdAt: { type: Date, default: Date.now, index: true },
});
CommunityMessageSchema.index({ community: 1, channelId: 1, createdAt: -1 });
module.exports = mongoose.model('CommunityMessage', CommunityMessageSchema);
