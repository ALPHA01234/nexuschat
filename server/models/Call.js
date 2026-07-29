const mongoose = require('mongoose');

const CallSchema = new mongoose.Schema({
  caller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  callee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['voice', 'video'], default: 'voice' },
  status: {
    type: String,
    enum: ['completed', 'missed', 'declined', 'cancelled'],
    default: 'missed',
  },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date },
  durationSec: { type: Number, default: 0 },
});

CallSchema.methods.toClientJSON = function (viewerId) {
  const isOutgoing = this.caller.equals(viewerId);
  return {
    id: this._id,
    direction: isOutgoing ? 'outgoing' : 'incoming',
    type: this.type,
    status: this.status,
    startedAt: this.startedAt.getTime(),
    durationSec: this.durationSec,
  };
};

module.exports = mongoose.model('Call', CallSchema);
