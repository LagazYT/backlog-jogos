<div align="center">

# 🎮 Backlog

**Aquele app pra você parar de mentir que vai zerar todos os jogos que comprou na promoção.**

Organize sua pilha de jogos, dê nota, escreva o que achou, veja quanto tempo leva pra zerar e cace conquistas, tudo no celular.

[![Baixar APK](https://img.shields.io/github/v/release/LagazYT/backlog-jogos?label=baixar%20APK&style=for-the-badge&color=FFD21F&labelColor=0B0B0C&logo=android&logoColor=FFD21F)](https://github.com/LagazYT/backlog-jogos/releases/latest)
![Android 8+](https://img.shields.io/badge/Android-8%2B-F03A2E?style=for-the-badge&labelColor=0B0B0C)
![Grátis](https://img.shields.io/badge/pre%C3%A7o-de%20gra%C3%A7a-F6F4EE?style=for-the-badge&labelColor=0B0B0C)

<img src="docs/banner.png" alt="Telas do app Backlog" width="100%">

</div>

---

## 🤔 Que app é esse?

Sabe aquela biblioteca na Steam com 300 jogos e você jogando o mesmo de sempre? Pois é.
O **Backlog** é um diário de jogos: você anota o que está jogando, o que quer jogar, o que zerou e o que largou no meio (sem julgamentos 👀).

Feito pelo canal **Lagaz**, pra quem leva a sério essa coisa de "um dia eu zero".

## ✨ O que ele faz

| | |
|---|---|
| 🗂️ **Biblioteca com capas de verdade** | Busca qualquer jogo pelo nome e o app baixa a capa certinha (Wikipédia + Steam). Ficou errada? Toca em *Trocar capa* e escolhe outra. As capas ficam salvas no celular e aparecem até sem internet. |
| 🕹️ **Plataforma em que você jogou** | PC, Xbox, PlayStation, Switch 1 ou Switch 2. |
| ⭐ **Nota e análise** | De 1 a 5 estrelas, mais um espaço pra escrever o que achou da história, do final, daquele chefe maldito… |
| ⏱️ **Quantas horas levou** | Anota suas horas e o app compara com a média: "você zerou 8 h abaixo da média", essas coisas. |
| 📊 **Tempo pra zerar** | Lista de single players populares com o tempo médio de *História*, *História + extras* e *100%*, no estilo HowLongToBeat. |
| 🔥 **Em alta agora** | Os single players com mais gente jogando neste exato momento, com número ao vivo da Steam. |
| 🏆 **Rastreador de conquistas** | Pesquisa um jogo da Steam e vê todas as conquistas (em português!), quantos % dos jogadores têm cada uma, quais são raras e secretas. Vai marcando as que você fez e acompanha o progresso. |
| 👤 **Perfil** | Nome, frase, cor do avatar, plataforma e jogo favoritos, e as suas estatísticas: jogos, zerados, horas, conquistas, nota média. |
| 🔗 **Steam, Xbox e PlayStation** | Conecta suas contas e o app puxa seus jogos, as horas jogadas e o progresso de conquistas e troféus direto pra biblioteca. Sua nota e análise não são mexidas. |
| 🔄 **Atualiza sozinho** | O app avisa (ou já baixa) quando sai versão nova. Também tem o botão *Buscar atualizações*. |
| ☁️ **Perfil offline ou conta** | Usa offline, tudo no celular, ou entra com Google pra salvar na nuvem (o login com Google está chegando). |
| 🎨 **Temas** | Modo escuro, claro ou do sistema, e três temas: **Arcade** (amarelo, vermelho e preto), **Grafite** e **Néon**. |
| 💾 **Backup** | Exporta e importa sua biblioteca quando quiser. |

## 📱 Por dentro

<table>
  <tr>
    <td align="center"><img src="docs/biblioteca.png" width="230"><br><sub><b>Biblioteca</b></sub></td>
    <td align="center"><img src="docs/jogo.png" width="230"><br><sub><b>Ficha do jogo</b></sub></td>
    <td align="center"><img src="docs/busca.png" width="230"><br><sub><b>Busca com capas</b></sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/em-alta.png" width="230"><br><sub><b>Em alta agora</b></sub></td>
    <td align="center"><img src="docs/tempo.png" width="230"><br><sub><b>Tempo pra zerar</b></sub></td>
    <td align="center"><img src="docs/conquistas.png" width="230"><br><sub><b>Conquistas</b></sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/perfil.png" width="230"><br><sub><b>Perfil</b></sub></td>
    <td align="center"><img src="docs/ajustes.png" width="230"><br><sub><b>Ajustes e temas</b></sub></td>
    <td align="center"><img src="docs/biblioteca-claro.png" width="230"><br><sub><b>Modo claro</b></sub></td>
  </tr>
</table>

## 📥 Como instalar

1. Abre a página de **[Releases](https://github.com/LagazYT/backlog-jogos/releases/latest)** pelo celular.
2. Baixa o arquivo **`Backlog.apk`**.
3. Toca nele. O Android vai perguntar se pode instalar apps dessa fonte, é só permitir.
4. Pronto, bora organizar esse backlog. 🎉

> Atualizou? Instala a versão nova por cima, sua biblioteca continua lá.

## 🧩 De onde vêm os dados

- **Capas e busca:** Wikipédia (cobre todas as plataformas, até Nintendo) e loja da Steam.
- **Jogadores agora e conquistas:** serviços públicos da Steam. Por isso conquistas e o ranking *Em alta* só valem pra jogos que estão na Steam.
- **Tempo pra zerar:** médias aproximadas da comunidade, guardadas em [`data.js`](app/src/main/assets/www/data.js). Quer adicionar um jogo? Manda um PR!
- **Contas de jogos:**
  - *Steam:* você entra na Steam dentro do app e ele cria sua chave pessoal da API (precisa dos detalhes de jogos públicos no perfil).
  - *PlayStation:* login na PSN dentro do app, o mesmo jeito que sites tipo PSNProfiles usam. Lê jogos de PS4/PS5, horas e troféus.
  - *Xbox:* via [OpenXBL](https://xbl.io), serviço gratuito, porque a Microsoft não libera acesso direto. Você cola a chave e pronto.
  - Chaves e acessos ficam só no seu celular, nunca vão pra nuvem.
- **Sua conta (opcional):** Firebase (login e banco de dados). Cada pessoa só consegue ler e escrever os próprios dados.

## 🛠️ Pra quem curte código

O app é um Android nativo bem levinho, com a interface em HTML, CSS e JavaScript puro, sem framework.

```
app/src/main/
├── java/com/lagaz/backlog/MainActivity.java   ← WebView, downloads, login do Google
└── assets/www/
    ├── index.html, style.css, app.js          ← o app inteiro
    ├── data.js                                ← tempos pra zerar
    └── firebase-config.js                     ← chaves públicas do Firebase
```

**Compilar:** todo push na `main` gera o APK sozinho pelo GitHub Actions e publica em Releases. Se preferir no PC: abre no Android Studio, ou roda `./gradlew assembleRelease`.

**Atualizar os prints deste README:** manda um push pra branch `screenshots` e o workflow tira tudo de novo com dados reais.

---

<div align="center">

Feito com 💛❤️🖤 por **Lagaz**. Se curtiu, deixa uma ⭐ aqui no repositório!

</div>
