/* ============================================================
   profile.js — sidebar mini-profile + the read-only Discord-style
   profile popout (own profile or a friend's). Editing your own
   profile always happens in Settings > Profile, never here.
   ============================================================ */

function renderMyProfile() {
  if (!state.me) return;
  document.getElementById('myNameSmall').textContent = state.me.displayName || state.me.username;
  applyPfpToEl(document.getElementById('myPfpSmall'), state.me.avatar, state.me.displayName);
}

function wireProfilePopout() {
  document.getElementById('myProfileTrigger').addEventListener('click', () => openProfilePopout(state.me.username, true));
  document.getElementById('chatHeaderUserTrigger').addEventListener('click', () => {
    if (state.activeChatWith) openProfilePopout(state.activeChatWith, false);
  });
}

async function openProfilePopout(username, isSelf) {
  let profile;
  if (isSelf) {
    profile = state.me;
  } else {
    try {
      const data = await apiFetch(`/users/${username}`);
      profile = data.user;
    } catch (err) {
      alert(err.message);
      return;
    }
  }

  applyBannerToEl(document.getElementById('profileModalBanner'), profile.banner);
  applyPfpToEl(document.getElementById('profileModalPfp'), profile.avatar, profile.displayName);
  document.getElementById('profileModalDisplay').textContent = profile.displayName || profile.username;
  document.getElementById('profileModalDisplay').style.color = profile.themeColor || 'var(--text)';
  document.getElementById('profileModalUsername').textContent = '@' + profile.username;

  const presence = isSelf ? { online: true } : (state.presence[username] || {});
  document.getElementById('profileModalStatus').textContent = profile.status
    ? profile.status
    : (presence.online ? 'Online' : 'Offline');

  const pronounsWrap = document.getElementById('profileModalPronounsWrap');
  if (profile.pronouns) {
    pronounsWrap.style.display = 'block';
    document.getElementById('profileModalPronouns').textContent = profile.pronouns;
  } else {
    pronounsWrap.style.display = 'none';
  }

  const bioWrap = document.getElementById('profileModalBioWrap');
  if (profile.bio) {
    bioWrap.style.display = 'block';
    document.getElementById('profileModalBio').textContent = profile.bio;
  } else {
    bioWrap.style.display = 'none';
  }

  const joined = profile.joinedAt ? new Date(profile.joinedAt) : null;
  document.getElementById('profileModalJoined').textContent = joined
    ? joined.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  const mutualWrap = document.getElementById('profileModalMutualWrap');
  const actionsEl = document.getElementById('profileModalActions');
  actionsEl.innerHTML = '';

  if (isSelf) {
    mutualWrap.style.display = 'none';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-primary';
    editBtn.textContent = 'Edit Profile';
    editBtn.addEventListener('click', () => { closeModal('profileModal'); openSettingsModal(); switchSettingsPage('profile'); });
    actionsEl.appendChild(editBtn);
  } else {
    mutualWrap.style.display = 'block';
    document.getElementById('profileModalMutual').textContent = 'Loading...';
    fetchMutualFriends(username).then(data => {
      document.getElementById('profileModalMutual').textContent = data.count === 0
        ? 'No mutual friends'
        : `${data.count} mutual friend${data.count === 1 ? '' : 's'}`;
    });

    if (findFriend(username)) {
      const msgBtn = document.createElement('button');
      msgBtn.className = 'btn-primary';
      msgBtn.textContent = 'Message';
      msgBtn.addEventListener('click', () => { closeModal('profileModal'); openChat(username); });
      actionsEl.appendChild(msgBtn);
    }

    const blockBtn = document.createElement('button');
    blockBtn.className = 'btn-danger';
    blockBtn.textContent = isBlocked(username) ? 'Unblock' : 'Block';
    blockBtn.addEventListener('click', async () => {
      if (isBlocked(username)) await unblockUser(username);
      else await blockUser(username);
      closeModal('profileModal');
    });
    actionsEl.appendChild(blockBtn);
  }

  openModal('profileModal');
}
