const { clone, shortId, uuid, asSubjectUpdates } = require('@m-ld/m-ld');
const { IoRemotes } = require('@m-ld/m-ld/dist/socket.io');
const MemDown = require('memdown');

class FormController {
  constructor() {
    const formId = /** @type {string} */
      window.location.pathname.split('/').slice(-1)[0];
    getElement('form-name').textContent = formId;
    getElement('add-party').disabled = true;
    getElement('add-item').disabled = true;
    clone(new MemDown, IoRemotes, {
      '@id': uuid(),
      '@domain': `${formId}.web-starter.m-ld.org`,
      genesis: getCookie('is-genesis') === 'true',
      logLevel: 'debug'
    }).then(meld => {
      // Get the latest data and populate the form
      meld.read(async state => {
        const parties = await state.read({
          '@describe': '?id',
          '@where': { '@id': '?id', '@type': 'Party' }
        });
        for (let party of parties)
          this.createPartyElement(meld, party);
        // Good to go!
        getElement('add-party').disabled = false;
        getElement('add-item').disabled = false;
      }, async (update, state) => {
        await Promise.all(Object.entries(asSubjectUpdates(update)).map(async ([id, subjectUpdate]) => {
          const element = getElement(id);
          if (element != null && element.classList.contains('party')) {
            const party = (await state.read({ '@describe': id }))[0];
            if (party != null) {
              this.updatePartyElement(party, element);
            } else {
              element.remove();
            }
          } else if (subjectUpdate['@insert']?.['@type'] === 'Party') {
            this.createPartyElement(meld, subjectUpdate['@insert']);
          }
        }));
      });
      getElement('add-party').addEventListener('click', () => {
        meld.write({ '@id': shortId(), '@type': 'Party', name: 'enter party name' });
      });
    }).catch(this.showError);
  }

  createPartyElement(meld, party) {
    const element = /** @type {HTMLElement} */
      getElement('party-template').cloneNode(true);
    element.classList.add('party');
    element.hidden = false;
    element.setAttribute('id', party['@id']);
    const nameInput = this.getPartyNameInput(element);
    nameInput.addEventListener('input', () => {
      meld.write({
        '@delete': { '@id': party['@id'], 'name': '?' },
        '@insert': { '@id': party['@id'], 'name': nameInput.value }
      });
    });
    element.querySelector('button').addEventListener('click', () => {
      meld.write({ '@delete': { '@id': party['@id'] } });
    });
    this.updatePartyElement(party, element);
    getElement('parties').appendChild(element);
    nameInput.select();
  }

  updatePartyElement(party, element) {
    this.getPartyNameInput(element).value = party.name;
  }

  getPartyNameInput(partyElement) {
    return partyElement.querySelector('input');
  }

  showMessage(msg, color) {
    const msgNode = getElement('message');
    if (color)
      msgNode.setAttribute('style', `color: ${color}`);
    msgNode.hidden = false;
    msgNode.textContent = `${msg}`;
  }

  showError = err => this.showMessage(err, 'red');
}

function getElement(id) {
  return document.getElementById(id);
}

function getCookie(name) {
  return document.cookie.match(`(?:^|;) ?${name}=([^;]*)(?:;|$)`)[1];
}

window.onload = () => new FormController();
