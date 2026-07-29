const mongoose = require("mongoose");

const ConversationSchema = new mongoose.Schema({
  participants: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  ],
  // Deterministic key = sorted participant ids joined by "_", used for fast lookup
  key: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  lastMessageAt: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

ConversationSchema.statics.keyFor = function (idA, idB) {
  return [idA.toString(), idB.toString()].sort().join("_");
};

module.exports = mongoose.model("Conversation", ConversationSchema);
