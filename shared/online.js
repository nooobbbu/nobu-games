(function(){
  const SUPABASE_URL='https://feomncowvpqjrhktcqsy.supabase.co';
  const SUPABASE_KEY='sb_publishable_0fl0zCtsaBwABJRJjftQuw_J8ipx61F';
  let client=null, player=null;
  const RECOVERY_KEY='nobu_games_recovery_code';

  function getStoredRecoveryCode(){
    try{return (localStorage.getItem(RECOVERY_KEY)||'').trim()}catch{return ''}
  }
  function setStoredRecoveryCode(code){
    try{if(code)localStorage.setItem(RECOVERY_KEY,String(code).trim().toUpperCase())}catch{}
  }
  function clearStoredRecoveryCode(){try{localStorage.removeItem(RECOVERY_KEY)}catch{}}

  function cleanError(err){
    const msg=err?.message||String(err||'通信エラー');
    if(/player name required/i.test(msg)) return 'プレイヤー名を入力してください';
    if(/authentication required/i.test(msg)) return 'オンライン認証に失敗しました';
    if(/player not registered/i.test(msg)) return 'プレイヤー登録が必要です';
    if(/recovery code not found/i.test(msg)) return '引き継ぎコードが見つかりません';
    if(/invalid recovery code/i.test(msg)) return '引き継ぎコードを確認してください';
    return msg;
  }

  async function rpc(name,args={}){
    if(!client) await init();
    const {data,error}=await client.rpc(name,args);
    if(error) throw new Error(cleanError(error));
    return data;
  }

  async function init(){
    if(client) return {client,player};
    if(!window.supabase?.createClient) throw new Error('Supabaseライブラリを読み込めません');
    client=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
    let {data:{session},error}=await client.auth.getSession();
    if(error) throw error;
    if(!session){
      const out=await client.auth.signInAnonymously();
      if(out.error) throw out.error;
      session=out.data.session;
    }
    if(!session) throw new Error('オンライン認証に失敗しました');

    player=await rpc('ng_get_profile');

    // 同じ公開URL・同じブラウザならSupabaseの匿名セッションは通常そのまま残る。
    // 何らかの理由で匿名セッションだけ再発行された場合は、
    // この端末に保存した引き継ぎコードで自動復旧する。
    if(!player){
      const saved=getStoredRecoveryCode();
      if(saved){
        try{
          player=await rpc('ng_recover',{p_code:saved});
        }catch(e){
          const m=cleanError(e);
          if(/引き継ぎコード/.test(m)) clearStoredRecoveryCode();
        }
      }
    }
    return {client,player};
  }

  async function ensurePlayer(){
    await init();
    if(player) return player;
    let name='';
    while(!name){
      name=(window.prompt('プレイヤー名を入力してください（1〜16文字）')||'').trim().slice(0,16);
    }
    player=await rpc('ng_ensure_player',{p_player_name:name});
    // 新規登録時は保険として引き継ぎコードも自動発行し、この端末へ保存する。
    try{
      const r=await rpc('ng_new_recovery');
      if(r?.recoveryCode)setStoredRecoveryCode(r.recoveryCode);
    }catch{}
    return player;
  }

  async function refreshProfile(){
    await init();
    player=await rpc('ng_get_profile');
    return player;
  }

  async function rename(name){
    await init();
    player=await rpc('ng_rename_player',{p_player_name:String(name||'').trim().slice(0,16)});
    return player;
  }

  async function newRecovery(){
    await init();
    const r=await rpc('ng_new_recovery');
    if(r?.recoveryCode)setStoredRecoveryCode(r.recoveryCode);
    return r;
  }

  async function recover(code){
    await init();
    const entered=String(code||'').trim().toUpperCase();
    player=await rpc('ng_recover',{p_code:entered});
    setStoredRecoveryCode(entered);
    return player;
  }

  async function submitGameScore(gameId,score,progress){
    return await rpc('ng_submit_game_score',{
      p_game_id:String(gameId||'').trim().toLowerCase(),
      p_score:Number(score||0),
      p_progress:Number(progress||1)
    });
  }

  async function gameLeaderboard(gameId,limit=100){
    return await rpc('ng_game_leaderboard',{
      p_game_id:String(gameId||'').trim().toLowerCase(),
      p_limit:Math.max(1,Math.min(100,Number(limit||100)))
    });
  }

  async function listGames(){
    return await rpc('ng_list_games');
  }

  async function api(path,opts={}){
    await init();
    let body={};
    if(opts.body){try{body=JSON.parse(opts.body)}catch{body={}}}
    switch(path){
      case '/api/profile':
        if((opts.method||'GET').toUpperCase()==='GET') return {player:await refreshProfile()};
        if(body.action==='register') {player=await rpc('ng_ensure_player',{p_player_name:String(body.playerName||'').trim().slice(0,16)});return {player};}
        if(body.action==='rename') return {player:await rename(body.playerName)};
        if(body.action==='newRecovery') return await newRecovery();
        if(body.action==='recover') return {player:await recover(body.recoveryCode)};
        throw new Error('未対応の操作です');
      case '/api/nobuxy/submit': {
        const r=await submitGameScore('nobuxy',body.score,body.level);
        const p=await refreshProfile();
        return {player:p,score:r.score};
      }
      case '/api/nobuxy/leaderboard': {
        const r=await gameLeaderboard('nobuxy',100);
        return {
          rows:(r.rows||[]).map(x=>({...x,best_level:x.best_progress})),
          myRank:r.myRank,
          me:r.me
        };
      }
      case '/api/stack/submit': {
        const r=await submitGameScore('stackquest',body.score,body.stage);
        return {score:{...r.score,best_stage:r.score?.best_progress}};
      }
      case '/api/stack/leaderboard': {
        const r=await gameLeaderboard('stackquest',100);
        return {
          rows:(r.rows||[]).map(x=>({...x,best_stage:x.best_progress})),
          myRank:r.myRank,
          me:r.me?{...r.me,best_stage:r.me.best_progress}:null
        };
      }
      case '/api/game/submit':
        return await submitGameScore(body.gameId,body.score,body.progress);
      case '/api/game/leaderboard':
        return await gameLeaderboard(body.gameId,body.limit||100);
      case '/api/games':
        return {games:await listGames()};
      default:
        throw new Error('未対応のAPIです');
    }
  }

  function getPlayer(){return player}
  window.OnlineCore={init,ensurePlayer,api,refreshProfile,rename,newRecovery,recover,getPlayer,getStoredRecoveryCode,submitGameScore,gameLeaderboard,listGames};
})();
