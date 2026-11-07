/**
 * Browser half of dsh-next-question.
 *
 * It reads the hidden `[//]: # (nextq: ...)` marker out of the newest
 * assistant message, paints it as ghost text over the empty composer, and
 * accepts it into the draft on Tab. Nothing here calls a model.
 */

window.__ModuleLoader__.load({
  id: 'dsh-next-question',
  factory: (require) => {
    const React = require('react')
    const { jsx } = require('react/jsx-runtime')

    /*
     * The marker is a CommonMark link reference definition the renderer drops.
     * Extraction stays deliberately loose: models put it inline, inside a
     * blockquote, with full-width brackets or a full-width colon, and older
     * answers show all of those variants.
     */
    const NEXTQ_RE = /\[[^\]\n]*\][ \t]*:[ \t]*#[ \t]*(?:"[ \t]*nextq[ \t]*[:：][ \t]*([^"\n]*)"|[(（][ \t]*nextq[ \t]*[:：][ \t]*([^()（）\n]*?)[ \t]*[)）])/gi

    const EMPTY_STORE = {
      subscribe: () => () => {},
      getSnapshot: () => null,
    }

    function useStore(store) {
      const subscribe = React.useCallback((onChange) => store.subscribe(onChange), [store])
      const getSnapshot = React.useCallback(() => store.getSnapshot(), [store])
      return React.useSyncExternalStore(subscribe, getSnapshot)
    }

    function messageText(content) {
      let text = ''
      if (!Array.isArray(content)) return text
      for (const block of content) {
        if (block && block.type === 'text' && typeof block.text === 'string') text += block.text
      }
      return text
    }

    function normalize(value) {
      return value
        .replace(/\s+/g, ' ')
        .replace(/^["'`「『]+/, '')
        .replace(/["'`」』]+$/, '')
        .trim()
        .slice(0, 160)
    }

    /**
     * Models occasionally copy the instruction's own placeholder instead of
     * replacing it. Such text is a template, never a prediction.
     */
    function isPlaceholder(value) {
      if (value.includes('<') || value.includes('>')) return true
      const plain = value.replace(/[《》［］[\]]/g, '').trim()
      return plain === '用户下一句最可能发送的话'
        || plain === 'the message the user is most likely to send next'
    }

    /**
     * The newest answer of the newest turn decides: an answer without the marker
     * clears the ghost, and tool-only steps are skipped so an intermediate step
     * cannot hide the prediction its own turn already produced.
     */
    function extractPrediction(snapshot) {
      const entries = snapshot && Array.isArray(snapshot.entries) ? snapshot.entries : []
      let turn
      let seen = false
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const event = entries[index] && entries[index].event
        if (!event || event.type !== 'assistant/message') continue
        if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') continue
        const eventTurn = event.data && event.data.turn
        if (!seen) {
          turn = eventTurn
          seen = true
        } else if (eventTurn !== turn) {
          // Older turns never resurrect a stale prediction.
          break
        }
        const text = messageText(event.data && event.data.message && event.data.message.content)
        if (text.trim() === '') continue
        let value = ''
        NEXTQ_RE.lastIndex = 0
        let match = NEXTQ_RE.exec(text)
        while (match !== null) {
          const candidate = normalize(match[1] || match[2] || '')
          if (candidate !== '' && candidate !== '...' && candidate !== '…' && candidate !== '预测内容' && !isPlaceholder(candidate)) value = candidate
          match = NEXTQ_RE.exec(text)
        }
        return value
      }
      return ''
    }

    /** Element the ghost is positioned against; the composer card is the offset parent. */
    function composerCard(node) {
      if (!(node instanceof Element)) return null
      return node.closest('[data-composer-card]')
    }

    function editorOf(card) {
      if (!(card instanceof Element)) return null
      return card.querySelector('[data-input-scroll] [contenteditable="true"]')
    }

    function useGhostLayout(cardRef, visible, prediction) {
      const [box, setBox] = React.useState(null)

      React.useLayoutEffect(() => {
        if (!visible) {
          setBox(null)
          return undefined
        }
        const card = composerCard(cardRef.current)
        const editor = editorOf(card)
        if (!(card instanceof HTMLElement) || !(editor instanceof HTMLElement)) return undefined

        const measure = () => {
          try {
            const cardRect = card.getBoundingClientRect()
            const editorRect = editor.getBoundingClientRect()
            const style = getComputedStyle(editor)
            const paddingLeft = parseFloat(style.paddingLeft) || 0
            const paddingRight = parseFloat(style.paddingRight) || 0
            const paddingTop = parseFloat(style.paddingTop) || 0
            // The overlay anchor sits at the card's top-left corner, so every
            // offset is expressed relative to the card rect.
            setBox({
              left: Math.round(editorRect.left - cardRect.left + paddingLeft),
              top: Math.round(editorRect.top - cardRect.top + paddingTop),
              width: Math.max(0, editorRect.width - paddingLeft - paddingRight),
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              lineHeight: style.lineHeight,
              letterSpacing: style.letterSpacing,
            })
          } catch (_error) {
            setBox(null)
          }
        }

        measure()
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure)
          observer.observe(card)
          observer.observe(editor)
          window.addEventListener('resize', measure)
          return () => {
            observer.disconnect()
            window.removeEventListener('resize', measure)
          }
        }
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [cardRef, visible, prediction])

      return box
    }

    function Ghost(props) {
      const shell = props.shell
      const input = useStore(shell.state)
      const sessionState = useStore(props.session || EMPTY_STORE)
      const [prediction, setPrediction] = React.useState('')
      const [hover, setHover] = React.useState(false)
      const anchorRef = React.useRef(null)

      React.useEffect(() => {
        const session = props.session
        const source = session && session.eventSource
        if (!source) {
          setPrediction('')
          return undefined
        }
        const read = () => {
          try {
            setPrediction(extractPrediction(source.getSnapshot()))
          } catch (_error) {
            setPrediction('')
          }
        }
        read()
        return source.subscribe(read)
      }, [props.session])

      const draft = input && typeof input.draft === 'string' ? input.draft : ''
      const attachments = input && Array.isArray(input.attachmentIds) ? input.attachmentIds.length : 0
      const running = Boolean(sessionState && sessionState.running)
      const visible = prediction !== '' && draft.trim() === '' && attachments === 0 && !running
      const box = useGhostLayout(anchorRef, visible, prediction)

      const accept = React.useCallback(() => {
        if (prediction === '') return
        const card = composerCard(anchorRef.current)
        try {
          const actions = shell.actions
          const span = actions.captureInsertion()
          if (!actions.insertText(prediction, span)) actions.setDraft(prediction)
        } catch (_error) {
          try {
            shell.actions.setDraft(prediction)
          } catch (_ignored) {
            return
          }
        }
        const editor = editorOf(card)
        if (editor instanceof HTMLElement) editor.focus()
      }, [prediction, shell])

      React.useEffect(() => {
        if (!visible) return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Tab') return
          if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
          if (event.isComposing) return
          const card = composerCard(anchorRef.current)
          if (!card) return
          const target = event.target
          if (!(target instanceof Element) || !card.contains(target)) return
          // Only inside the draft editor; Tab elsewhere keeps normal focus movement.
          if (!target.closest('[data-input-scroll] [contenteditable="true"]')) return
          // The slash/@ menu owns Tab while it is open.
          if (card.querySelector('[data-trigger-menu]')) return
          event.preventDefault()
          event.stopPropagation()
          accept()
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [visible, accept])

      // The native placeholder sits at the same origin. Hide it while the
      // prediction occupies that spot so the two never overlap.
      React.useLayoutEffect(() => {
        const card = composerCard(anchorRef.current)
        if (!card) return undefined
        if (visible) card.setAttribute('data-nextq-active', '')
        else card.removeAttribute('data-nextq-active')
        return () => card.removeAttribute('data-nextq-active')
      }, [visible])

      const style = box === null ? undefined : {
        position: 'absolute',
        left: box.left + 'px',
        top: box.top + 'px',
        maxWidth: box.width + 'px',
        fontFamily: box.fontFamily,
        fontSize: box.fontSize,
        fontWeight: box.fontWeight,
        lineHeight: box.lineHeight,
        letterSpacing: box.letterSpacing,
        color: 'var(--dsw-alias-label-tertiary)',
        opacity: hover ? '0.85' : '0.55',
        whiteSpace: 'pre',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: '2',
      }

      return jsx('div', {
        ref: anchorRef,
        'aria-hidden': true,
        'data-next-question-host': '',
        style: { position: 'absolute', inset: '0 0 auto', height: '0', pointerEvents: 'none' },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        children: visible && style !== undefined
          ? jsx('div', {
              'data-next-question-ghost': '',
              title: prediction + '  (Tab 采纳)',
              style,
              children: prediction,
            })
          : null,
      })
    }

    function GhostEntry(props) {
      // Resolve lazily at render time: the session binding always exists by then,
      // while a slot inject can run before it is retained.
      const shell = props.shell ?? (typeof props.resolveShell === 'function' ? props.resolveShell() : undefined)
      if (!shell) return null
      const session = props.session ?? (typeof props.resolveSession === 'function' ? props.resolveSession() : undefined)
      return jsx(Ghost, { ...props, shell, session })
    }

    /**
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-next-question-style', '')
        // Only the ghost's own card hides the placeholder, so embedded
        // composers and other sessions keep theirs.
        style.textContent = '[data-composer-card][data-nextq-active] [data-composer-placeholder]{visibility:hidden!important}'
        document.head.appendChild(style)
        return () => style.remove()
      }, 'next-question placeholder style')
      ctx.inject(['slots', 'sessions', 'conversation'], (scope) => {
        const sessions = scope.sessions
        const conversation = scope.conversation
        scope.slots.inject('conversation.input.overlay', () => scope.slots.register({
          name: 'conversation.input.overlay',
          id: 'next-question',
          order: 10,
          inject: (sessionId) => {
            const resolveShell = () => {
              try {
                const actx = sessions.scope(sessionId)
                return actx === undefined ? undefined : conversation.input.for(actx)
              } catch (_error) {
                return undefined
              }
            }
            const resolveSession = () => {
              try {
                const actx = sessions.scope(sessionId)
                const scoped = actx === undefined ? undefined : sessions.sessionOf(actx)
                if (scoped !== undefined) return scoped
                return typeof sessions.binding === 'function' ? sessions.binding(sessionId)?.session : undefined
              } catch (_error) {
                return undefined
              }
            }
            return {
              sessionId,
              resolveShell,
              resolveSession,
            }
          },
        }, GhostEntry))
      })
    }

    const module = { exports: {} }
    module.exports.apply = apply
    return module.exports
  },
})
