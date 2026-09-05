function wireCommunitiesUI(){
  document.getElementById('dmHomeRailBtn')?.addEventListener('click', showDmHome);
  document.getElementById('createCommunityRailBtn')?.addEventListener('click',()=>openModal('communityHubModal'));
  document.getElementById('hubCreateCommunityBtn')?.addEventListener('click',()=>{closeModal('communityHubModal');openModal('communityCreateModal');});
  document.getElementById('hubJoinBtn')?.addEventListener('click',joinCommunityFromHub);
  document.getElementById('communityMembersBtn')?.addEventListener('click',toggleCommunityMembers);
  // Professional community settings button is wired in professional.js
  document.getElementById('rotateInviteBtn')?.addEventListener('click',rotateCommunityInvite);
  document.getElementById('leaveCommunityBtn')?.addEventListener('click',leaveCommunity);
  document.getElementById('deleteCommunityBtn')?.addEventListener('click',deleteCommunity);
  document.getElementById('communityMuteBtn')?.addEventListener('click',toggleCommunityMute);
  document.getElementById('communityCreateForm')?.addEventListener('submit',async e=>{e.preventDefault();await createCommunity();});
  document.getElementById('joinCommunityBtn')?.addEventListener('click',joinCommunityByCode);
  document.getElementById('communityChannelCreateBtn')?.addEventListener('click',()=>openModal('channelCreateModal'));
  document.getElementById('channelCreateForm')?.addEventListener('submit',async e=>{e.preventDefault();await createCommunityChannel();});
  document.getElementById('communityComposer')?.addEventListener('submit',async e=>{e.preventDefault();await sendCommunityMessage();});
  document.getElementById('communityInviteBtn')?.addEventListener('click',copyCommunityInvite);
  document.getElementById('leaveCommunityVoiceBtn')?.addEventListener('click',leaveCommunityVoice);
}

async function loadCommunities(){
  try{ const d=await apiFetch('/communities'); state.communities=d.communities||[]; renderCommunityRail(); }
  catch(e){ console.error('load communities',e); }
}
function communityIconLabel(c){ return (c.name||'?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase(); }
function renderCommunityRail(){
  const host=document.getElementById('communityRailList'); if(!host)return; host.innerHTML='';
  state.communities.forEach(c=>{
    const b=document.createElement('button'); b.className='rail-icon community-rail-icon'+(state.activeCommunity?.id===c.id?' active':''); b.title=c.name;
    if(c.icon) b.innerHTML=`<img src="${c.icon}" alt="">`; else b.textContent=communityIconLabel(c);
    b.addEventListener('click',()=>openCommunity(c.id)); host.appendChild(b);
  });
}
function showDmHome(){
  state.activeCommunity=null; state.activeCommunityChannel=null;
  document.getElementById('dmSidebarView').style.display='flex';
  document.getElementById('communitySidebarView').style.display='none';
  document.getElementById('communityView').classList.remove('active');
  state.activeChatWith=null; document.getElementById('chatView').classList.remove('active'); document.getElementById('emptyState').style.display='none'; showHomeView?.();
  document.querySelectorAll('.rail-icon').forEach(x=>x.classList.remove('active')); document.getElementById('dmHomeRailBtn').classList.add('active');
  renderCommunityRail();
}
async function createCommunity(){
  const name=document.getElementById('communityNameInput').value.trim(), description=document.getElementById('communityDescriptionInput').value.trim();
  const error=document.getElementById('communityCreateError'); if(error) error.textContent=''; if(name.length<2){if(error)error.textContent='Community name must be at least 2 characters.';return;}
  try{const d=await apiFetch('/communities',{method:'POST',body:JSON.stringify({name,description})}); closeModal('communityCreateModal'); document.getElementById('communityCreateForm').reset(); await loadCommunities(); openCommunity(d.community.id);}catch(e){document.getElementById('communityCreateError').textContent=e.message;}
}
async function joinCommunityByCode(){
  const code=document.getElementById('communityJoinCode').value.trim(); if(!code)return;
  try{const d=await apiFetch('/communities/join',{method:'POST',body:JSON.stringify({inviteCode:code})}); document.getElementById('communityJoinCode').value=''; await loadCommunities(); openCommunity(d.community.id);}catch(e){alert(e.message);}
}

async function joinCommunityFromHub(){const code=document.getElementById('hubJoinCode').value.trim();if(!code)return;try{const d=await apiFetch('/communities/join',{method:'POST',body:JSON.stringify({inviteCode:code})});closeModal('communityHubModal');document.getElementById('hubJoinCode').value='';await loadCommunities();openCommunity(d.community.id);}catch(e){alert(e.message);}}
function toggleCommunityManage(){const p=document.getElementById('communityManagePanel'),channels=document.getElementById('communityChannels'),members=document.getElementById('communityMemberList');const show=p.style.display==='none';p.style.display=show?'flex':'none';channels.style.display=show?'none':'block';members.style.display='none';}
async function rotateCommunityInvite(){const c=state.activeCommunity;if(!c)return;try{const d=await apiFetch(`/communities/${c.id}/invite/rotate`,{method:'POST'});state.activeCommunity.inviteCode=d.inviteCode;showToast?.('Invite code rotated.');}catch(e){alert(e.message);}}
async function leaveCommunity(){const c=state.activeCommunity;if(!c)return;if(!confirm(`Leave ${c.name}?`))return;try{await apiFetch(`/communities/${c.id}/leave`,{method:'POST'});showDmHome();await loadCommunities();}catch(e){alert(e.message);}}
async function deleteCommunity(){const c=state.activeCommunity;if(!c)return;const typed=prompt(`Type ${c.name} to permanently delete this community.`);if(typed!==c.name)return;try{await apiFetch(`/communities/${c.id}`,{method:'DELETE'});showDmHome();await loadCommunities();}catch(e){alert(e.message);}}
function toggleCommunityMembers(){const members=document.getElementById('communityMemberList'),channels=document.getElementById('communityChannels');const show=members.style.display==='none';members.style.display=show?'block':'none';channels.style.display=show?'none':'block';if(show)renderCommunityMembers();}
function renderCommunityMembers(){const h=document.getElementById('communityMemberList');h.innerHTML='';const members=state.activeCommunity?.members||[];members.forEach(m=>{const u=m.user||{};const row=document.createElement('div');row.className='community-member-row';row.innerHTML='<div class="community-member-avatar"></div><div><strong>'+escapeHtml(u.displayName||u.username||'Member')+'</strong><small>@'+escapeHtml(u.username||'')+' · '+escapeHtml(m.role||'member')+'</small></div>';applyPfpToEl(row.querySelector('.community-member-avatar'),u.avatar,u.displayName||u.username);h.appendChild(row);});}

async function openCommunity(id){
  try{
    const d=await apiFetch(`/communities/${id}`); state.activeCommunity=d.community; state.activeChatWith=null; hideHomeView?.();
    document.getElementById('dmSidebarView').style.display='none'; document.getElementById('communitySidebarView').style.display='flex';
    document.getElementById('emptyState').style.display='none'; document.getElementById('chatView').classList.remove('active'); document.getElementById('communityView').classList.add('active');
    document.getElementById('communitySidebarName').textContent=d.community.name; document.getElementById('communitySidebarDescription').textContent=d.community.description||`${d.community.memberCount} members`;
    document.getElementById('communityChannelCreateBtn').style.display=['owner','admin'].includes(d.community.role)?'inline-flex':'none';
    document.getElementById('communityMemberList').style.display='none'; document.getElementById('communityManagePanel').style.display='none'; document.getElementById('communityChannels').style.display='block'; const del=document.getElementById('deleteCommunityBtn'); if(del) del.style.display=d.community.role==='owner'?'inline-flex':'none'; renderCommunityChannels(); renderCommunityMembers(); renderCommunityRail();
    state.socket?.emit('community:subscribe',{communityId:id});
    const first=d.community.channels.find(c=>c.type==='text'); if(first)openCommunityChannel(first.id);
  }catch(e){alert(e.message);}
}
function renderCommunityChannels(){
  const c=state.activeCommunity, host=document.getElementById('communityChannels'); if(!c||!host)return; host.innerHTML='';
  const canManage=['owner','admin'].includes(c.role);
  const cats={}; c.channels.sort((a,b)=>a.position-b.position).forEach(ch=>(cats[ch.category]??=[]).push(ch));
  Object.entries(cats).forEach(([cat,chs])=>{
    const h=document.createElement('div');h.className='channel-category';h.textContent=cat;host.appendChild(h);
    chs.forEach(ch=>{
      const row=document.createElement('div');row.className='channel-row-wrap';
      const b=document.createElement('button');b.className='channel-row'+(state.activeCommunityChannel?.id===ch.id?' active':''); b.innerHTML=`<span>${ch.type==='voice'?'◖':'#'}</span><strong>${escapeHtml(ch.name)}</strong>`; b.addEventListener('click',()=>openCommunityChannel(ch.id));
      row.appendChild(b);
      if(canManage){
        const manage=document.createElement('button');manage.className='icon-btn small channel-manage-btn';manage.title='Manage channel';manage.textContent='⋯';
        manage.addEventListener('click',(e)=>{e.stopPropagation();manageCommunityChannel(ch);});
        row.appendChild(manage);
      }
      host.appendChild(row);
    });
  });
}
async function manageCommunityChannel(ch){
  const c=state.activeCommunity; if(!c)return;
  const choice=prompt(`"#${ch.name}" — type "rename", "delete", or Cancel:`);
  if(!choice)return;
  const action=choice.trim().toLowerCase();
  if(action==='rename'){
    const name=prompt('New channel name:',ch.name); if(!name||!name.trim())return;
    try{const d=await apiFetch(`/communities/${c.id}/channels/${ch.id}`,{method:'PATCH',body:JSON.stringify({name:name.trim()})}); state.activeCommunity=d.community; renderCommunityChannels(); if(state.activeCommunityChannel?.id===ch.id){state.activeCommunityChannel=d.community.channels.find(x=>x.id===ch.id);document.getElementById('communityHeaderName').textContent=(ch.type==='text'?'# ':'◖ ')+state.activeCommunityChannel.name;}}catch(e){alert(e.message);}
  } else if(action==='delete'){
    if(!confirm(`Delete #${ch.name}? This cannot be undone.`))return;
    try{const d=await apiFetch(`/communities/${c.id}/channels/${ch.id}`,{method:'DELETE'}); state.activeCommunity=d.community; if(state.activeCommunityChannel?.id===ch.id){state.activeCommunityChannel=null; const first=d.community.channels.find(x=>x.type==='text'); if(first)openCommunityChannel(first.id);} renderCommunityChannels();}catch(e){alert(e.message);}
  }
}
async function createCommunityChannel(){
  const c=state.activeCommunity;if(!c)return; const name=document.getElementById('channelNameInput').value.trim(); const type=document.getElementById('channelTypeInput').value;
  const category=document.getElementById('channelCreateForm').dataset.category||undefined; try{const d=await apiFetch(`/communities/${c.id}/channels`,{method:'POST',body:JSON.stringify({name,type,category})}); state.activeCommunity=d.community; closeModal('channelCreateModal'); document.getElementById('channelCreateForm').reset(); delete document.getElementById('channelCreateForm').dataset.category; renderCommunityChannels(); renderCsCategories?.();}catch(e){document.getElementById('channelCreateError').textContent=e.message;}
}
async function openCommunityChannel(channelId){
  const ch=state.activeCommunity?.channels.find(x=>x.id===channelId); if(!ch)return; state.activeCommunityChannel=ch; renderCommunityChannels();
  document.getElementById('communityHeaderName').textContent=(ch.type==='text'?'# ':'◖ ')+ch.name;
  document.getElementById('communityTextPane').style.display=ch.type==='text'?'flex':'none'; document.getElementById('communityVoicePane').style.display=ch.type==='voice'?'flex':'none';
  if(ch.type==='text') await loadCommunityMessages(); else await joinCommunityVoice(ch);
}
async function loadCommunityMessages(){
  const c=state.activeCommunity,ch=state.activeCommunityChannel;if(!c||!ch)return;
  try{const d=await apiFetch(`/communities/${c.id}/channels/${ch.id}/messages`); renderCommunityMessages(d.messages||[]);}catch(e){console.error(e);}
}
function renderCommunityMessages(msgs){const h=document.getElementById('communityMessages');h.innerHTML='';msgs.forEach(appendCommunityMessage);h.scrollTop=h.scrollHeight;}
function appendCommunityMessage(m){
  const h=document.getElementById('communityMessages'); if(!h||state.activeCommunityChannel?.id!==m.channelId && m.channelId) return;
  const row=document.createElement('div');row.className='community-message';row.innerHTML=`<div class="community-msg-pfp"></div><div><div class="community-msg-meta"><strong>${escapeHtml(m.sender?.displayName||m.sender?.username||'User')}</strong><span>@${escapeHtml(m.sender?.username||'')}</span><time>${formatTime(m.createdAt)}</time></div><div class="community-msg-body">${escapeHtml(m.content)}</div></div>`; applyPfpToEl(row.querySelector('.community-msg-pfp'),m.sender?.avatar,m.sender?.displayName);h.appendChild(row);h.scrollTop=h.scrollHeight;
}
async function sendCommunityMessage(){const input=document.getElementById('communityMessageInput');const text=input.value.trim();const c=state.activeCommunity,ch=state.activeCommunityChannel;if(!text||!c||!ch)return;input.value='';try{await apiFetch(`/communities/${c.id}/channels/${ch.id}/messages`,{method:'POST',body:JSON.stringify({content:text})});}catch(e){alert(e.message);}}
function onCommunityMessage(m){if(state.activeCommunity?.id===m.communityId&&state.activeCommunityChannel?.id===m.channelId)appendCommunityMessage(m);}
function copyCommunityInvite(){const c=state.activeCommunity;if(!c)return;navigator.clipboard?.writeText(c.inviteCode).then(()=>alert(`Invite code copied: ${c.inviteCode}`)).catch(()=>prompt('Copy this invite code:',c.inviteCode));}

async function joinCommunityVoice(ch){
  if(state.communityVoice.channelId===ch.id)return; await leaveCommunityVoice();
  try{
    const deviceId=localStorage.getItem('nexus_audio_input')||'';
    const stream=await navigator.mediaDevices.getUserMedia({audio:{...(deviceId?{deviceId:{exact:deviceId}}:{}),echoCancellation:true,noiseSuppression:true}});
    state.communityVoice.stream=stream;state.communityVoice.communityId=state.activeCommunity.id;state.communityVoice.channelId=ch.id;state.communityVoice.muted=false;state.communityVoice.monitors=new Map();state.communityVoice.pendingIce=new Map();
    document.getElementById('communityVoiceTitle').textContent=`Connected to ${ch.name}`;
    renderVcParticipant('me',state.me.username,state.me.displayName||state.me.username,state.me.avatar);
    startVcSpeakingMonitor('me',stream);
    state.socket.emit('community:voice-join',{communityId:state.activeCommunity.id,channelId:ch.id});
  } catch(e){console.error(e);alert('Microphone access is required to join this voice channel.');}
}
function toggleCommunityMute(){const cv=state.communityVoice;if(!cv.stream)return;cv.muted=!cv.muted;cv.stream.getAudioTracks().forEach(t=>t.enabled=!cv.muted);const b=document.getElementById('communityMuteBtn');b.textContent=cv.muted?'Unmute':'Mute';b.classList.toggle('muted',cv.muted);}
async function leaveCommunityVoice(){const cv=state.communityVoice;state.socket?.emit('community:voice-leave');cv.peers.forEach(pc=>pc.close());cv.peers.clear();cv.stream?.getTracks().forEach(t=>t.stop());cv.stream=null;cv.communityId=null;cv.channelId=null;(cv.monitors||new Map()).forEach(fn=>fn());cv.monitors=new Map();document.querySelectorAll('audio[data-vc-audio]').forEach(a=>{forgetBlockedMedia(a);a.remove();});document.getElementById('communityVoiceParticipants').innerHTML='';document.getElementById('communityVoiceTitle').textContent='Not connected';document.getElementById('communityMuteBtn').textContent='Mute';}
function createVcPeer(peerSocketId, initiator){
  const cv=state.communityVoice; const pc=new RTCPeerConnection({iceServers:(state.iceServers&&state.iceServers.length?state.iceServers:[{urls:'stun:stun.l.google.com:19302'}])}); cv.peers.set(peerSocketId,pc); cv.stream?.getTracks().forEach(t=>pc.addTrack(t,cv.stream)); cv.pendingIce.set(peerSocketId,[]);
  pc.onicecandidate=e=>{if(e.candidate)state.socket.emit('community:voice-signal',{to:peerSocketId,communityId:cv.communityId,channelId:cv.channelId,candidate:e.candidate});};
  pc.ontrack=async e=>{const stream=e.streams[0]||new MediaStream([e.track]);if(e.track.kind!=='audio')return;let a=document.getElementById(`vc-audio-${peerSocketId}`);if(!a){a=document.createElement('audio');a.id=`vc-audio-${peerSocketId}`;a.dataset.vcAudio='1';a.autoplay=true;a.playsInline=true;a.muted=false;a.volume=1;document.body.appendChild(a);}a.srcObject=stream;await routeAudioOutput(a);playMediaWithUnlockFallback(a);startVcSpeakingMonitor(peerSocketId,stream);};
  if(initiator) queueMicrotask(async()=>{try{const offer=await pc.createOffer();await pc.setLocalDescription(offer);state.socket.emit('community:voice-signal',{to:peerSocketId,communityId:cv.communityId,channelId:cv.channelId,description:pc.localDescription});}catch(e){console.error('VC offer',e);}});
  return pc;
}
async function onCommunityVoiceSignal(d){if(d.communityId!==state.communityVoice.communityId||d.channelId!==state.communityVoice.channelId)return;let pc=state.communityVoice.peers.get(d.from)||createVcPeer(d.from,false);try{if(d.description){await pc.setRemoteDescription(new RTCSessionDescription(d.description));for(const c of state.communityVoice.pendingIce.get(d.from)||[])await pc.addIceCandidate(c);state.communityVoice.pendingIce.set(d.from,[]);if(d.description.type==='offer'){const ans=await pc.createAnswer();await pc.setLocalDescription(ans);state.socket.emit('community:voice-signal',{to:d.from,communityId:d.communityId,channelId:d.channelId,description:pc.localDescription});}}else if(d.candidate){const c=new RTCIceCandidate(d.candidate);if(pc.remoteDescription)await pc.addIceCandidate(c);else(state.communityVoice.pendingIce.get(d.from)||[]).push(c);}}catch(e){console.error('VC signal',e);}}
function communityMemberByUsername(username){return(state.activeCommunity?.members||[]).find(m=>m.user?.username===username)?.user||null;}
function renderVcParticipant(id,username,name,avatar){const h=document.getElementById('communityVoiceParticipants');let d=h.querySelector(`[data-vc-user="${id}"]`);if(d)return;const u=avatar?{avatar,displayName:name,username}:communityMemberByUsername(username);d=document.createElement('div');d.className='vc-participant';d.dataset.vcUser=id;d.innerHTML='<div class="vc-avatar"></div><strong>'+escapeHtml(name||u?.displayName||username||'Member')+'</strong>';applyPfpToEl(d.querySelector('.vc-avatar'),avatar||u?.avatar,name||u?.displayName||username);h.appendChild(d);}
function startVcSpeakingMonitor(id,stream){const cv=state.communityVoice;if(cv.monitors?.has(id))return;const el=document.querySelector(`[data-vc-user="${id}"] .vc-avatar`);if(!el||!stream?.getAudioTracks().length)return;try{const ctx=new(window.AudioContext||window.webkitAudioContext)();const src=ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));const an=ctx.createAnalyser();an.fftSize=256;src.connect(an);const data=new Uint8Array(an.frequencyBinCount);let active=true,raf=0,lastAbove=0;const HOLD_MS=250;const tick=()=>{if(!active)return;an.getByteTimeDomainData(data);let sum=0;for(const v of data){const n=(v-128)/128;sum+=n*n;}const now=performance.now();if(Math.sqrt(sum/data.length)>.035)lastAbove=now;el.classList.toggle('speaking',(now-lastAbove)<HOLD_MS);raf=requestAnimationFrame(tick)};tick();cv.monitors.set(id,()=>{active=false;cancelAnimationFrame(raf);el.classList.remove('speaking');try{ctx.close()}catch(e){}});}catch(e){}}
function onCommunityVoicePeers({communityId,channelId,peers}){if(communityId!==state.communityVoice.communityId||channelId!==state.communityVoice.channelId)return;peers.forEach(p=>{renderVcParticipant(p.socketId,p.username,p.displayName||p.username,p.avatar);createVcPeer(p.socketId,true);});}
function onCommunityVoiceJoined(d){if(d.communityId!==state.communityVoice.communityId||d.channelId!==state.communityVoice.channelId)return;renderVcParticipant(d.socketId,d.username,d.displayName||d.username,d.avatar);}
function onCommunityVoiceLeft(d){const pc=state.communityVoice.peers.get(d.socketId);if(pc){pc.close();state.communityVoice.peers.delete(d.socketId);}state.communityVoice.monitors?.get(d.socketId)?.();state.communityVoice.monitors?.delete(d.socketId);document.querySelector(`[data-vc-user="${d.socketId}"]`)?.remove();const audioEl=document.getElementById(`vc-audio-${d.socketId}`);if(audioEl){forgetBlockedMedia(audioEl);audioEl.remove();}}

