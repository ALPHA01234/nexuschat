const Community = require('../models/Community');
const User = require('../models/user');

const voiceRooms = new Map(); // room -> Map(socketId,{userId,username})

function registerCommunityHandlers(socket) {
  socket.on('community:subscribe', async ({ communityId }) => {
    const c = await Community.findById(communityId).select('members.user');
    if (!c || !c.members.some(m => String(m.user) === String(socket.userId))) return;
    socket.join(`community:${communityId}`);
  });

  socket.on('community:voice-join', async ({communityId, channelId}) => {
    const c=await Community.findById(communityId);
    if(!c || !c.memberRole(socket.userId) || !c.channels.id(channelId) || c.channels.id(channelId).type!=='voice') return;
    const room=`vc:${communityId}:${channelId}`;
    socket.join(room); socket.data.communityVoiceRoom=room;
    if(!voiceRooms.has(room)) voiceRooms.set(room,new Map());
    const peers=voiceRooms.get(room);
    const me=await User.findById(socket.userId).select('username displayName avatar');
    const existing=[...peers.entries()].map(([socketId,p])=>({socketId,...p}));
    const selfInfo={userId:socket.userId,username:socket.username,displayName:me?.displayName||socket.username,avatar:me?.avatar||null};
    peers.set(socket.id,selfInfo);
    socket.emit('community:voice-peers',{communityId,channelId,peers:existing});
    socket.to(room).emit('community:voice-user-joined',{communityId,channelId,socketId:socket.id,...selfInfo});
  });

  socket.on('community:voice-signal', ({to,communityId,channelId,description,candidate}) => {
    if(!to) return;
    socket.to(to).emit('community:voice-signal',{from:socket.id,communityId,channelId,description,candidate,username:socket.username});
  });

  const leaveVoice=()=>{
    const room=socket.data.communityVoiceRoom; if(!room) return;
    const parts=room.split(':'); const communityId=parts[1],channelId=parts.slice(2).join(':');
    socket.leave(room); const peers=voiceRooms.get(room); if(peers){peers.delete(socket.id); if(!peers.size)voiceRooms.delete(room);}
    socket.to(room).emit('community:voice-user-left',{communityId,channelId,socketId:socket.id});
    socket.data.communityVoiceRoom=null;
  };
  socket.on('community:voice-leave', leaveVoice);
  socket.on('disconnecting', leaveVoice);
}
module.exports={registerCommunityHandlers};
