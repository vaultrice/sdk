import { describe, it, expect, beforeAll } from 'vitest'
import { createSyncObject } from '../../src/index'
import Base from '../../src/Base'
import { setTimeout as wait } from 'node:timers/promises'
import uuidv4 from '../../src/uuidv4'

describe(`SyncObject (${process.env.MODE})`, () => {
  const basePath = process.env.BASE_PATH as string
  const apiKey = process.env.API_KEY as string
  const apiSecret = process.env.API_SECRET as string
  const projectId = process.env.PROJECT_ID as string
  const className = process.env.CLASS_NAME as string

  beforeAll(() => {
    // @ts-ignore
    Base.basePath = basePath
  })

  describe('basic usage', () => {
    it('should work as expected', async () => {
      interface MyObj { myProp?: string, myProp2?: string, counter: number }
      const id = uuidv4()
      const so = await createSyncObject<MyObj>({ apiKey, apiSecret, projectId }, { id, class: className })
      expect(so.myProp).to.eql(undefined)
      so.myProp = 'my-value'
      expect(so.myProp).to.eql('my-value')
      await wait(500)

      const so2 = await createSyncObject<MyObj>({ apiKey, apiSecret, projectId }, { id, class: className })
      expect(so2.myProp).to.eql('my-value')
      so2['myProp2'] = 'my-value-2'
      expect(so2.myProp2).to.eql('my-value-2')
      await wait(500)
      expect(so.myProp2).to.eql('my-value-2')

      so.myProp2 = undefined
      await wait(500)
      expect(so.myProp2).to.eql(undefined)
      expect(so2.myProp2).to.eql(undefined)

      so2.counter++
    })
  })
})
