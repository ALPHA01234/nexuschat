const mongoose = require('mongoose');

const AttachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    filename: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    kind: { type: String, enum: ['image', 'video', 'file'], default: 'file' },
  },
  { _id: false }
);

const MessageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  type: { type: String, enum: ['text', 'voice', 'attachment'], default: 'text' },
  content: { type: String, default: '' }, // text body, or base64 data URL for voice notes
  duration: { type: Number, default: 0 }, // voice note seconds
  attachment: { type: AttachmentSchema, default: null },

  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },

  edited: { type: Boolean, default: false },
  editedAt: { type: Date },

  deleted: { type: Boolean, default: false },
  deletedAt: { type: Date },

  pinned: { type: Boolean, default: false },
  pinnedAt: { type: Date },

  status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
  deliveredAt: { type: Date },
  readAt: { type: Date },

  ts: { type: Date, default: Date.now, index: true },
});

MessageSchema.index({ conversation: 1, ts: 1 });
MessageSchema.index({ conversation: 1, content: 'text' });

MessageSchema.methods.toClientJSON = function () {
  return {
    id: this._id,
    conversationId: this.conversation,
    from: this.from,
    to: this.to,
    type: this.type,
    content: this.deleted ? '' : this.content,
    duration: this.duration,
    attachment: this.deleted ? null : this.attachment,
    replyTo: this.replyTo,
    edited: this.edited,
    deleted: this.deleted,
    pinned: this.pinned,
    status: this.status,
    ts: this.ts.getTime(),
  };
};

module.exports = mongoose.model('Message', MessageSchema);
