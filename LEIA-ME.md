# Backlog — app Android de backlog de jogos

## Gerar o APK (sem instalar nada no PC)

1. Crie um repositório no GitHub (pode ser privado) e envie todos estes arquivos.
   Pelo PC: `git init && git add . && git commit -m "Backlog" && git branch -M main && git remote add origin <url> && git push -u origin main`
2. O GitHub compila sozinho (aba **Actions** → "Gerar APK", leva uns 4 minutos).
3. Abra a aba **Releases** do repositório pelo celular e baixe o `Backlog.apk`.
4. Toque no arquivo e permita "instalar apps desconhecidos" quando o Android pedir.

Cada novo envio gera uma versão nova, assinada com a mesma chave, então dá para atualizar por cima sem perder a biblioteca.

## Gerar pelo Android Studio
Abra a pasta, espere sincronizar e use *Build → Build APK(s)*. Ou `./gradlew assembleRelease`.

## Como funciona
- Busca: Wikipédia (capas de caixa de todas as plataformas) + loja da Steam (capas verticais de PC).
- As capas são baixadas para o armazenamento interno do app e funcionam offline.
- Se uma capa vier errada, abra o jogo e toque em **Trocar capa**.
- A aba Tempo usa médias de horas aproximadas da comunidade (estilo HowLongToBeat), em `app/src/main/assets/www/data.js` — dá para editar ou adicionar jogos ali.
- Interface em `app/src/main/assets/www/` (HTML, CSS e JS); código nativo em `MainActivity.java`.
