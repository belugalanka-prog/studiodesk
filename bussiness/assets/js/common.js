import { supabase } from './supabase.js';
export const money = n => new Intl.NumberFormat('en-LK',{style:'currency',currency:'LKR',maximumFractionDigits:0}).format(Number(n||0));
export const date = d => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-LK',{day:'numeric',month:'short',year:'numeric'}) : '—';
export function toast(message){let el=document.querySelector('.toast');if(!el){el=document.createElement('div');el.className='toast';document.body.append(el)}el.textContent=message;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),3000)}
export function escapeHTML(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
export async function requireUser(role){const {data:{user}}=await supabase.auth.getUser();if(!user){location.href=role==='client'?'../client-login.html':'../login.html';return null}const {data:profile}=await supabase.from('profiles').select('*').eq('id',user.id).single();if(!profile||profile.role!==role){await supabase.auth.signOut();location.href=role==='client'?'../client-login.html':'../login.html';return null}return {user,profile}}
export async function logActivity(action, detail={}){const {data:{user}}=await supabase.auth.getUser();if(user)await supabase.from('activity_logs').insert({actor_id:user.id,action,detail})}
