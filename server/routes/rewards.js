const express = require('express');
const crypto = require('crypto');
const RewardClaim = require('../models/RewardClaim');
const User = require('../models/user');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const router = express.Router();

const QUIZZES = [
  { q:'Which protocol secures normal HTTPS web traffic?', options:['FTP','TLS','SMTP','IRC'], answer:1 },
  { q:'Which value should never be committed to a public Git repository?', options:['CSS class name','API secret','Page title','Button label'], answer:1 },
  { q:'What does 2FA add to an account?', options:['A second verification factor','A second username','Two browsers','Two passwords stored in plain text'], answer:0 },
  { q:'Which status code commonly means “Not Found”?', options:['200','301','404','500'], answer:2 },
  { q:'What does WebRTC primarily enable in NexusChat?', options:['Local file renaming','Real-time peer media','Database backups','Email delivery'], answer:1 },
];
function dayKey(){ return new Date().toISOString().slice(0,10); }
function todayQuiz(){ const key=dayKey(); const n=[...key].reduce((a,c)=>a+c.charCodeAt(0),0); return QUIZZES[n % QUIZZES.length]; }

router.get('/status', requireAuth, asyncHandler(async (req,res) => {
  const key=dayKey(); const claimed=await RewardClaim.exists({user:req.user._id,kind:'daily-quiz',key});
  const q=todayQuiz();
  res.json({ coins:req.user.nexusCoins||0, quiz:{ key, question:q.q, options:q.options, reward:10, claimed:!!claimed }, rewardedAds:{ enabled:!!process.env.REWARDED_AD_PROVIDER, provider:process.env.REWARDED_AD_PROVIDER||null } });
}));

router.post('/quiz', requireAuth, asyncHandler(async (req,res) => {
  const key=dayKey();
  if (await RewardClaim.exists({user:req.user._id,kind:'daily-quiz',key})) return res.status(409).json({message:'Today’s quiz reward has already been claimed.'});
  const q=todayQuiz(); const answer=Number(req.body.answer);
  if (answer !== q.answer) return res.status(400).json({message:'That answer is not correct. Try again tomorrow for a new quiz.'});
  try {
    await RewardClaim.create({user:req.user._id,kind:'daily-quiz',key,amount:10});
  } catch(e){ if (e.code===11000) return res.status(409).json({message:'Today’s quiz reward has already been claimed.'}); throw e; }
  req.user.nexusCoins=(req.user.nexusCoins||0)+10; await req.user.save();
  res.json({message:'10 Nexus Coins added.', coins:req.user.nexusCoins});
}));

// Provider-facing completion hook. Browser clients cannot mint coins themselves.
router.post('/ad-webhook/:provider', asyncHandler(async (req,res) => {
  const secret=process.env.REWARDED_AD_WEBHOOK_SECRET;
  if (!secret || req.get('x-nexus-reward-secret') !== secret) return res.status(401).json({message:'Invalid reward signature.'});
  const { userId, receipt, amount } = req.body || {};
  const safeAmount=Math.max(1,Math.min(Number(amount)||0,250));
  if (!userId || !receipt || !safeAmount) return res.status(400).json({message:'Missing reward data.'});
  const key=crypto.createHash('sha256').update(String(receipt)).digest('hex');
  try { await RewardClaim.create({user:userId,kind:'rewarded-ad',key,amount:safeAmount,provider:req.params.provider,providerReceipt:String(receipt)}); }
  catch(e){ if(e.code===11000) return res.json({ok:true,duplicate:true}); throw e; }
  await User.findByIdAndUpdate(userId,{$inc:{nexusCoins:safeAmount}});
  res.json({ok:true});
}));
module.exports=router;
