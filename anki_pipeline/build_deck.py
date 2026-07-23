# -*- coding: utf-8 -*-
"""qcrop2/, acrop2/, all_texts.json から .apkg を生成"""
import json, genanki, os, html

texts = json.load(open('all_texts.json'))
n_total = 136  # bands2.json の総問題数

model = genanki.Model(1607392324, '薬剤QA-v4',
  fields=[{'name':'問題'},{'name':'解答'},{'name':'解説'}],
  templates=[{'name':'Card1','qfmt':'{{問題}}',
    'afmt':'{{FrontSide}}<hr id="answer"><b>解答:</b> {{解答}}<br><br>{{解説}}'}],
  css='.card{font-family:sans-serif;font-size:18px;text-align:left;} img{max-width:100%;}')
deck = genanki.Deck(2059400115, '製剤学 過去問(テキスト+画像)')
media = set()
for qn in range(1, n_total+1):
    qi, ai = f'qcrop2/Q{qn:03d}.jpg', f'acrop2/A{qn:03d}.jpg'
    media.add(qi); media.add(ai)
    t = texts.get(str(qn))
    if t:
        front = f"<b>問{qn}</b><br>{t['q']}<br><img src='Q{qn:03d}.jpg'>"
        ans, exp = t['a'], f"{t['e']}<br><img src='A{qn:03d}.jpg'>"
    else:
        front = f"<b>問{qn}</b><br><img src='Q{qn:03d}.jpg'>"
        ans, exp = '画像参照', f"<img src='A{qn:03d}.jpg'>"
    deck.add_note(genanki.Note(model=model, fields=[front, ans, exp]))
pkg = genanki.Package(deck); pkg.media_files = sorted(media)
pkg.write_to_file('製剤学過去問_完全版.apkg')
print('done')
