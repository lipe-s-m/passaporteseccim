import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validContent,publicContent} from '../supabase/functions/passport/activity-content.mjs';

export const content={name:'Palestra',category:'Dados',description:'Descrição',short_description:'Resumo',
  speaker_name:'Ana',speaker_bio:'Mini bio',speaker_photo_url:'https://res.cloudinary.com/demo/image/upload/ana.jpg',
  event_date:'2026-11-04',starts_at:'2026-11-04T14:00:00-03:00',ends_at:'2026-11-04T15:00:00-03:00',
  slides_url:'https://docs.google.com/presentation/d/exemplo',speaker_socials:{linkedin:'https://www.linkedin.com/in/ana'}};

test('editor valida links, limites, calendário e data no fuso do evento',()=>{
  assert(validContent(content));
  for(const changes of [{name:''},{name:'x'.repeat(201)},{speaker_photo_url:'https://evil.test/a.jpg'},
    {speaker_photo_url:'https://user:pass@res.cloudinary.com/demo/image/upload/a.jpg'},
    {speaker_socials:{linkedin:'https://evil.test/a'}},{speaker_socials:{admin:'https://site.test'}},
    {slides_url:'javascript:alert(1)'},{event_date:'2026-02-30'},
    {starts_at:'2026-11-04T01:00:00Z'},{ends_at:'2026-11-04T12:00:00-03:00'},
    {starts_at:null,ends_at:content.ends_at},{speaker_bio:null},{firebase_uid:'admin'}]) {
    assert.equal(validContent({...content,...changes}),false,JSON.stringify(changes));
  }
});

test('resposta editorial não devolve campos extras do banco',()=>{
  const result=publicContent({...content,id:'palestra',content_revision:2,content_updated_by:'uid-privado',email:'privado'});
  assert.equal(result.content_revision,2);assert.equal(result.name,'Palestra');
  assert(!('content_updated_by' in result));assert(!('email' in result));
});
