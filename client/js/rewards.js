function wireRewardsUI(){
  document.getElementById('rewardsRailBtn')?.addEventListener('click',openRewardsModal);
  document.getElementById('coinWalletChip')?.addEventListener('click',openRewardsModal);
  document.getElementById('coinWalletChipDm')?.addEventListener('click',openRewardsModal);
  document.getElementById('earnCoinsBtn')?.addEventListener('click',openRewardsModal);
  document.getElementById('dailyQuizSubmitBtn')?.addEventListener('click',submitDailyQuiz);
}
function refreshCoinUI(){const n=Number(state.me?.nexusCoins||0).toLocaleString();['topCoinBalance','topCoinBalanceDm','nexusCoinBalance','rewardsCoinBalance'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=n;});}
async function openRewardsModal(){openModal('rewardsModal');await loadRewards();}
async function loadRewards(){
  const status=document.getElementById('rewardedAdStatus');
  try{const d=await apiFetch('/rewards/status');if(state.me){state.me.nexusCoins=d.coins;refreshCoinUI();}
    document.getElementById('dailyQuizQuestion').textContent=d.quiz.question;const h=document.getElementById('dailyQuizOptions');h.innerHTML='';d.quiz.options.forEach((o,i)=>{const l=document.createElement('label');l.className='quiz-option';l.innerHTML=`<input type="radio" name="dailyQuizAnswer" value="${i}"><span>${escapeHtml(o)}</span>`;h.appendChild(l);});
    document.getElementById('dailyQuizSubmitBtn').disabled=d.quiz.claimed;document.getElementById('dailyQuizState').textContent=d.quiz.claimed?'Today’s 10-coin quiz reward is already claimed.':'Answer correctly to earn 10 Nexus Coins.';
    status.textContent=d.rewardedAds.enabled?`Rewarded ads provider connected: ${d.rewardedAds.provider}.`:'Rewarded ads are not connected yet. This button stays disabled until a server-verified provider is configured.';
    document.getElementById('rewardedAdBtn').disabled=!d.rewardedAds.enabled;
  }catch(e){status.textContent=e.message;}
}
async function submitDailyQuiz(){const pick=document.querySelector('input[name="dailyQuizAnswer"]:checked');if(!pick){document.getElementById('dailyQuizState').textContent='Choose an answer first.';return;}try{const d=await apiFetch('/rewards/quiz',{method:'POST',body:JSON.stringify({answer:Number(pick.value)})});state.me.nexusCoins=d.coins;refreshCoinUI();document.getElementById('dailyQuizState').textContent=d.message;document.getElementById('dailyQuizSubmitBtn').disabled=true;}catch(e){document.getElementById('dailyQuizState').textContent=e.message;}}
