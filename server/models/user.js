const mongoose = require('mongoose');

const PfpSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['color', 'image'], default: 'color' },
    value: { type: String, default: '#ff1f3d' },
  },
  { _id: false }
);

const BannerSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['color', 'image'], default: 'color' },
    value: { type: String, default: '#5865f2' },
  },
  { _id: false }
);

const PrivacySchema = new mongoose.Schema(
  {
    friendRequests: { type: String, enum: ['everyone', 'friends-of-friends', 'none'], default: 'everyone' },
    readReceipts: { type: Boolean, default: true },
    typingIndicator: { type: Boolean, default: true },
    onlineVisibility: { type: Boolean, default: true },
  },
  { _id: false }
);

const NotificationSchema = new mongoose.Schema(
  {
    desktop: { type: Boolean, default: true },
    mentions: { type: Boolean, default: true },
    sounds: { type: Boolean, default: true },
    friendRequestAlerts: { type: Boolean, default: true },
  },
  { _id: false }
);

const AppearanceSchema = new mongoose.Schema(
  {
    theme: { type: String, enum: ['dark', 'light'], default: 'dark' },
    fontSize: { type: String, enum: ['small', 'medium', 'large'], default: 'medium' },
    compactMode: { type: Boolean, default: false },
    animations: { type: Boolean, default: true },
    enterToSend: { type: Boolean, default: true },
    timestamp24h: { type: Boolean, default: false },
    reduceMotion: { type: Boolean, default: false },
    highContrast: { type: Boolean, default: false },
  },
  { _id: false }
);

const WarningSchema = new mongoose.Schema(
  {
    message: { type: String, required: true, maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    acknowledgedAt: { type: Date, default: null },
  },
  { _id: true }
);

const PremiumSchema = new mongoose.Schema(
  {
    active: { type: Boolean, default: false },
    until: { type: Date, default: null },
    source: { type: String, default: 'none', maxlength: 40 },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 16,
    match: /^[a-zA-Z0-9_]+$/,
    index: true,
  },
  usernameChangedAt: { type: Date, default: null },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    index: true,
  },
  emailVerified: { type: Boolean, default: false },
  password: { type: String, required: true },

  displayName: { type: String, default: '', maxlength: 32 },
  avatar: { type: PfpSchema, default: () => ({ type: 'color', value: '#ff1f3d' }) },
  banner: { type: BannerSchema, default: () => ({ type: 'color', value: '#5865f2' }) },
  bio: { type: String, default: '', maxlength: 190 },
  status: { type: String, default: '', maxlength: 60 },
  pronouns: { type: String, default: '', maxlength: 30 },
  themeColor: { type: String, default: '#ff1f3d' },
  badges: { type: [String], default: [] },

  role: { type: String, enum: ['user', 'moderator', 'admin'], default: 'user', index: true },
  accountStatus: { type: String, enum: ['active', 'restricted', 'suspended', 'banned'], default: 'active', index: true },
  restrictionReason: { type: String, default: '', maxlength: 500 },
  warnings: { type: [WarningSchema], default: [] },

  premium: { type: PremiumSchema, default: () => ({ active: false, until: null, source: 'none' }) },
  nexusCoins: { type: Number, default: 0, min: 0 },

  policies: {
    acceptedAt: { type: Date, default: null },
    termsVersion: { type: String, default: '' },
    privacyVersion: { type: String, default: '' },
    guidelinesVersion: { type: String, default: '' },
  },

  online: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  privacy: { type: PrivacySchema, default: () => ({}) },
  notifications: { type: NotificationSchema, default: () => ({}) },
  appearance: { type: AppearanceSchema, default: () => ({}) },
  createdAt: { type: Date, default: Date.now },
});

UserSchema.index({ username: 'text', displayName: 'text' });

UserSchema.methods.hasPremium = function () {
  if (!this.premium?.active) return false;
  if (!this.premium.until) return true;
  return new Date(this.premium.until) > new Date();
};

UserSchema.methods.toPublicJSON = function () {
  return {
    id: this._id,
    username: this.username,
    displayName: this.displayName || this.username,
    avatar: this.avatar,
    banner: this.banner,
    bio: this.bio,
    status: this.status,
    pronouns: this.pronouns,
    themeColor: this.themeColor,
    badges: this.badges,
    premium: { active: this.hasPremium() },
    online: this.privacy?.onlineVisibility === false ? false : this.online,
    lastSeen: this.lastSeen,
    joinedAt: this.createdAt,
  };
};

UserSchema.methods.toPrivateJSON = function () {
  return {
    ...this.toPublicJSON(),
    email: this.email,
    emailVerified: this.emailVerified,
    role: this.role,
    accountStatus: this.accountStatus,
    restrictionReason: this.restrictionReason,
    warnings: (this.warnings || []).map(w => ({
      id: w._id,
      message: w.message,
      createdAt: w.createdAt,
      acknowledgedAt: w.acknowledgedAt,
    })),
    nexusCoins: this.nexusCoins || 0,
    privacy: this.privacy,
    notifications: this.notifications,
    appearance: this.appearance,
    policies: this.policies,
    blockedUsers: this.blockedUsers,
  };
};

module.exports = mongoose.model('User', UserSchema);
