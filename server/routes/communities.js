const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { body } = require('express-validator');
const Community = require('../models/Community');
const CommunityMessage = require('../models/CommunityMessage');
const { requireAuth } = require('../middleware/auth');
const { handleValidation } = require('../middleware/errorHandler');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();
const newCode = () => crypto.randomBytes(5).toString('hex');
const memberQuery = (userId) => ({ 'members.user': userId });

function serialize(c, meId) {
  return {
    id: c._id,
    name: c.name,
    description: c.description,
    icon: c.icon,
    inviteCode: c.inviteCode,
    inviteExpiresAt: c.inviteExpiresAt || null,
    inviteMaxUses: c.inviteMaxUses ?? null,
    inviteUses: c.inviteUses || 0,
    role: c.memberRole(meId),
    ownerId: c.owner?._id || c.owner,
    memberCount: c.members.length,
    categories: (c.categories || []).map(cat => ({ id: cat._id, name: cat.name, position: cat.position })),
    channels: c.channels.map(ch => ({ id: ch._id, name: ch.name, type: ch.type, category: ch.category, position: ch.position })),
    bannedUsers: (c.bannedUsers || []).map(u => u && typeof u === 'object' && u.username ? (u.toPublicJSON ? u.toPublicJSON() : { id:u._id, username:u.username, displayName:u.displayName, avatar:u.avatar }) : String(u)),
    createdAt: c.createdAt,
  };
}

router.get('/', requireAuth, asyncHandler(async (req,res) => {
  const communities = await Community.find(memberQuery(req.user._id)).sort({ createdAt: 1 });
  res.json({ communities: communities.map(c => serialize(c, req.user._id)) });
}));

router.post('/', requireAuth,
  [body('name').trim().isLength({min:2,max:40}), body('description').optional().isLength({max:220})],
  handleValidation,
  asyncHandler(async (req,res) => {
    const c = await Community.create({
      name: req.body.name.trim(), description: String(req.body.description||'').trim(), icon: String(req.body.icon||''),
      owner: req.user._id, inviteCode: newCode(),
      members: [{ user: req.user._id, role: 'owner' }],
      categories: [{ name:'TEXT CHANNELS', position:0 }, { name:'VOICE CHANNELS', position:1 }],
      channels: [
        { name: 'general', type: 'text', category: 'TEXT CHANNELS', position: 0 },
        { name: 'General', type: 'voice', category: 'VOICE CHANNELS', position: 1 },
      ],
    });
    res.status(201).json({ community: serialize(c, req.user._id) });
  })
);

router.post('/join', requireAuth, [body('inviteCode').trim().notEmpty()], handleValidation,
  asyncHandler(async (req,res) => {
    const c = await Community.findOne({ inviteCode: req.body.inviteCode.trim().toLowerCase() });
    if (!c) return res.status(404).json({ message: 'Invite code not found.' });
    if ((c.bannedUsers || []).some(id => String(id?._id || id) === String(req.user._id))) return res.status(403).json({ message: 'You are banned from this community.' });
    if (!c.memberRole(req.user._id)) {
      if (c.inviteExpiresAt && c.inviteExpiresAt.getTime() < Date.now()) {
        return res.status(410).json({ message: 'This invite has expired.' });
      }
      if (c.inviteMaxUses != null && c.inviteUses >= c.inviteMaxUses) {
        return res.status(410).json({ message: 'This invite has reached its use limit.' });
      }
      c.members.push({ user: req.user._id, role: 'member' });
      c.inviteUses = (c.inviteUses || 0) + 1;
      await c.save();
    }
    res.json({ community: serialize(c, req.user._id) });
  })
);

router.get('/:id', requireAuth, asyncHandler(async (req,res) => {
  const c = await Community.findById(req.params.id).populate('members.user','username displayName avatar online').populate('bannedUsers','username displayName avatar');
  if (!c || !c.memberRole(req.user._id)) return res.status(404).json({ message: 'Community not found.' });
  const out = serialize(c, req.user._id);
  out.members = c.members.map(m => ({ role:m.role, user: m.user?.toPublicJSON ? m.user.toPublicJSON() : m.user }));
  res.json({ community: out });
}));


router.patch('/:id', requireAuth,
  [body('name').optional().trim().isLength({min:2,max:40}), body('description').optional().isLength({max:220}), body('icon').optional().isLength({max:2200000})],
  handleValidation,
  asyncHandler(async (req,res) => {
    const c = await Community.findById(req.params.id);
    if (!c || !c.canManage(req.user._id)) return res.status(403).json({ message:'Community admin access required.' });
    if (req.body.name != null) c.name = req.body.name.trim();
    if (req.body.description != null) c.description = String(req.body.description).trim();
    if (req.body.icon != null) c.icon = String(req.body.icon);
    await c.save();
    res.json({ community: serialize(c, req.user._id) });
  })
);

router.post('/:id/categories', requireAuth,
  [body('name').trim().isLength({min:1,max:40})], handleValidation,
  asyncHandler(async (req,res) => {
    const c = await Community.findById(req.params.id);
    if (!c || !c.canManage(req.user._id)) return res.status(403).json({ message:'Community admin access required.' });
    const name=req.body.name.trim();
    if ((c.categories||[]).some(x=>x.name.toLowerCase()===name.toLowerCase())) return res.status(409).json({message:'Category already exists.'});
    c.categories.push({name,position:c.categories.length}); await c.save();
    res.status(201).json({community:serialize(c,req.user._id)});
  })
);

router.patch('/:id/categories/:categoryId', requireAuth,
  [body('name').optional().trim().isLength({min:1,max:40}), body('position').optional().isInt({min:0,max:1000})], handleValidation,
  asyncHandler(async (req,res) => {
    const c=await Community.findById(req.params.id); if(!c||!c.canManage(req.user._id)) return res.status(403).json({message:'Community admin access required.'});
    let cat=mongoose.Types.ObjectId.isValid(req.params.categoryId) ? c.categories.id(req.params.categoryId) : null; if(!cat) cat=(c.categories||[]).find(x=>x.name===req.params.categoryId);
    if(!cat) return res.status(404).json({message:'Category not found.'}); const old=cat.name;
    if(req.body.name){cat.name=req.body.name.trim();c.channels.forEach(ch=>{if(ch.category===old)ch.category=cat.name;});}
    if(req.body.position!=null)cat.position=Number(req.body.position); await c.save(); res.json({community:serialize(c,req.user._id)});
  })
);

router.delete('/:id/categories/:categoryId', requireAuth, asyncHandler(async(req,res)=>{
  const c=await Community.findById(req.params.id); if(!c||!c.canManage(req.user._id)) return res.status(403).json({message:'Community admin access required.'});
  let cat=mongoose.Types.ObjectId.isValid(req.params.categoryId) ? c.categories.id(req.params.categoryId) : null; if(!cat) cat=(c.categories||[]).find(x=>x.name===req.params.categoryId); if(!cat)return res.status(404).json({message:'Category not found.'});
  const old=cat.name; c.channels.forEach(ch=>{if(ch.category===old)ch.category='General';}); cat.deleteOne();
  if(!(c.categories||[]).some(x=>x.name==='General')) c.categories.push({name:'General',position:c.categories.length}); await c.save(); res.json({community:serialize(c,req.user._id)});
}));

router.post('/:id/channels', requireAuth,
  [body('name').trim().isLength({min:1,max:40}), body('type').isIn(['text','voice']), body('category').optional().isLength({max:40})],
  handleValidation,
  asyncHandler(async (req,res) => {
    const c = await Community.findById(req.params.id);
    if (!c || !c.canManage(req.user._id)) return res.status(403).json({ message: 'Only community admins can create channels.' });
    c.channels.push({ name:req.body.name.trim(), type:req.body.type, category:(req.body.category|| (req.body.type==='voice'?'VOICE CHANNELS':'TEXT CHANNELS')).trim(), position:c.channels.length });
    await c.save();
    res.status(201).json({ community: serialize(c, req.user._id) });
  })
);

router.patch('/:id/channels/:channelId', requireAuth,
  [body('name').optional().trim().isLength({min:1,max:40}), body('category').optional().trim().isLength({min:1,max:40})],
  handleValidation,
  asyncHandler(async (req,res) => {
    const c = await Community.findById(req.params.id);
    if (!c || !c.canManage(req.user._id)) return res.status(403).json({ message: 'Only community admins can rename channels.' });
    const ch = c.channels.id(req.params.channelId);
    if (!ch) return res.status(404).json({ message: 'Channel not found.' });
    if (req.body.name) ch.name = req.body.name.trim();
    if (req.body.category) ch.category = req.body.category.trim();
    await c.save();
    res.json({ community: serialize(c, req.user._id) });
  })
);

router.delete('/:id/channels/:channelId', requireAuth, asyncHandler(async (req,res) => {
  const c = await Community.findById(req.params.id);
  if (!c || !c.canManage(req.user._id)) return res.status(403).json({ message: 'Only community admins can delete channels.' });
  const ch = c.channels.id(req.params.channelId);
  if (!ch) return res.status(404).json({ message:'Channel not found.' });
  if (c.channels.length <= 1) return res.status(400).json({ message:'A community needs at least one channel.' });
  ch.deleteOne();
  await CommunityMessage.deleteMany({ community:c._id, channelId:req.params.channelId });
  await c.save();
  res.json({ community: serialize(c, req.user._id) });
}));

router.get('/:id/channels/:channelId/messages', requireAuth, asyncHandler(async (req,res) => {
  const c = await Community.findById(req.params.id);
  if (!c || !c.memberRole(req.user._id)) return res.status(403).json({ message:'Not a community member.' });
  const ch = c.channels.id(req.params.channelId);
  if (!ch || ch.type !== 'text') return res.status(404).json({ message:'Text channel not found.' });
  const rows = await CommunityMessage.find({ community:c._id, channelId:ch._id }).sort({createdAt:-1}).limit(100).populate('sender','username displayName avatar premium');
  res.json({ messages: rows.reverse().map(m => ({ id:m._id, content:m.content, createdAt:m.createdAt, sender:m.sender?.toPublicJSON ? m.sender.toPublicJSON() : m.sender })) });
}));

router.post('/:id/channels/:channelId/messages', requireAuth, [body('content').trim().isLength({min:1,max:4000})], handleValidation,
  asyncHandler(async (req,res) => {
    const c = await Community.findById(req.params.id);
    if (!c || !c.memberRole(req.user._id)) return res.status(403).json({ message:'Not a community member.' });
    const ch = c.channels.id(req.params.channelId);
    if (!ch || ch.type !== 'text') return res.status(404).json({ message:'Text channel not found.' });
    const m = await CommunityMessage.create({ community:c._id, channelId:ch._id, sender:req.user._id, content:req.body.content.trim() });
    await m.populate('sender','username displayName avatar premium');
    const payload = { id:m._id, communityId:String(c._id), channelId:String(ch._id), content:m.content, createdAt:m.createdAt, sender:m.sender.toPublicJSON() };
    req.app.get('io')?.to(`community:${c._id}`).emit('community:message', payload);
    res.status(201).json({ message: payload });
  })
);


router.post('/:id/leave', requireAuth, asyncHandler(async (req,res) => {
  const c = await Community.findById(req.params.id);
  if (!c || !c.memberRole(req.user._id)) return res.status(404).json({ message:'Community not found.' });
  if (String(c.owner) === String(req.user._id)) return res.status(400).json({ message:'Transfer ownership or delete the community before leaving.' });
  c.members = c.members.filter(m => String(m.user?._id || m.user) !== String(req.user._id));
  await c.save();
  res.json({ message:'You left the community.' });
}));

router.delete('/:id', requireAuth, asyncHandler(async (req,res) => {
  const c = await Community.findById(req.params.id);
  if (!c) return res.status(404).json({ message:'Community not found.' });
  if (String(c.owner) !== String(req.user._id)) return res.status(403).json({ message:'Only the community owner can delete it.' });
  await CommunityMessage.deleteMany({ community:c._id });
  await c.deleteOne();
  res.json({ message:'Community permanently deleted.' });
}));

router.patch('/:id/members/:userId/role', requireAuth,
  [body('role').isIn(['admin','member'])], handleValidation,
  asyncHandler(async (req,res) => {
    const c = await Community.findById(req.params.id);
    if (!c || String(c.owner) !== String(req.user._id)) return res.status(403).json({ message:'Only the owner can change community roles.' });
    const m = c.members.find(x => String(x.user?._id || x.user) === String(req.params.userId));
    if (!m) return res.status(404).json({ message:'Member not found.' });
    if (String(m.user?._id || m.user) === String(c.owner)) return res.status(400).json({ message:'Owner role cannot be changed.' });
    m.role = req.body.role;
    await c.save();
    res.json({ community: serialize(c, req.user._id) });
  })
);

router.delete('/:id/members/:userId', requireAuth, asyncHandler(async (req,res) => {
  const c = await Community.findById(req.params.id);
  if (!c || !c.canManage(req.user._id)) return res.status(403).json({ message:'Community admin access required.' });
  if (String(req.params.userId) === String(c.owner)) return res.status(400).json({ message:'The owner cannot be removed.' });
  c.members = c.members.filter(m => String(m.user?._id || m.user) !== String(req.params.userId));
  await c.save();
  res.json({ community: serialize(c, req.user._id) });
}));


router.post('/:id/members/:userId/ban', requireAuth, asyncHandler(async (req,res) => {
  const c = await Community.findById(req.params.id);
  if (!c || !c.canManage(req.user._id)) return res.status(403).json({ message:'Community admin access required.' });
  if (String(req.params.userId) === String(c.owner)) return res.status(400).json({ message:'The owner cannot be banned.' });
  c.members = c.members.filter(m => String(m.user?._id || m.user) !== String(req.params.userId));
  if (!(c.bannedUsers||[]).some(x=>String(x?._id||x)===String(req.params.userId))) c.bannedUsers.push(req.params.userId);
  await c.save(); await c.populate('bannedUsers','username displayName avatar');
  res.json({ community: serialize(c, req.user._id) });
}));

router.delete('/:id/bans/:userId', requireAuth, asyncHandler(async (req,res) => {
  const c = await Community.findById(req.params.id);
  if (!c || !c.canManage(req.user._id)) return res.status(403).json({ message:'Community admin access required.' });
  c.bannedUsers = (c.bannedUsers||[]).filter(x=>String(x?._id||x)!==String(req.params.userId));
  await c.save(); await c.populate('bannedUsers','username displayName avatar');
  res.json({ community: serialize(c, req.user._id) });
}));

router.post('/:id/invite/rotate', requireAuth,
  [body('expiresInHours').optional({nullable:true}).isInt({min:1,max:8760}), body('maxUses').optional({nullable:true}).isInt({min:1,max:100000})],
  handleValidation,
  asyncHandler(async (req,res) => {
    const c = await Community.findById(req.params.id);
    if (!c || !c.canManage(req.user._id)) return res.status(403).json({ message:'Only community admins can rotate invites.' });
    c.inviteCode = newCode();
    c.inviteUses = 0;
    c.inviteExpiresAt = req.body.expiresInHours ? new Date(Date.now() + Number(req.body.expiresInHours) * 3600000) : null;
    c.inviteMaxUses = req.body.maxUses ? Number(req.body.maxUses) : null;
    await c.save();
    res.json({ inviteCode:c.inviteCode, inviteExpiresAt:c.inviteExpiresAt, inviteMaxUses:c.inviteMaxUses });
  })
);

module.exports = router;
