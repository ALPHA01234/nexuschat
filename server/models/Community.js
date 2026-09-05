const mongoose = require('mongoose');

const ChannelSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 40 },
  type: { type: String, enum: ['text', 'voice'], default: 'text' },
  category: { type: String, default: 'General', maxlength: 40 },
  position: { type: Number, default: 0 },
}, { _id: true });

const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 40 },
  position: { type: Number, default: 0 },
}, { _id: true });

const MemberSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
  joinedAt: { type: Date, default: Date.now },
}, { _id: false });

const CommunitySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 40 },
  description: { type: String, default: '', maxlength: 220 },
  icon: { type: String, default: '', maxlength: 2200000 },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  members: { type: [MemberSchema], default: [] },
  categories: { type: [CategorySchema], default: [] },
  channels: { type: [ChannelSchema], default: [] },
  bannedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  inviteCode: { type: String, required: true, unique: true, index: true },
  inviteExpiresAt: { type: Date, default: null },
  inviteMaxUses: { type: Number, default: null },
  inviteUses: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

CommunitySchema.methods.memberRole = function(userId) {
  const m = this.members.find(x => String(x.user?._id || x.user) === String(userId));
  return m ? m.role : null;
};
CommunitySchema.methods.canManage = function(userId) {
  return ['owner','admin'].includes(this.memberRole(userId));
};

module.exports = mongoose.model('Community', CommunitySchema);
