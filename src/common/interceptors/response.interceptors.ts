/**
 * 对响应体进行转换结构
 * @author Innei
 */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { isArrayLike, isObjectLike } from 'lodash'
import { PaginateResult } from 'mongoose'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import snakecaseKeys from 'snakecase-keys'
import { HTTP_RES_TRANSFORM_PAGINATE } from '~/constants/meta.constant'
import { Paginator } from '~/shared/model/base.model'

export interface Response<T> {
  data: T
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Response<T>> {
  constructor(private readonly reflector: Reflector) {}
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    const reorganize = (data) => {
      if (!data) {
        throw new UnprocessableEntityException('数据丢失了(｡ ́︿ ̀｡)')
      }
      return typeof data !== 'object' || data.__proto__.constructor === Object
        ? { ...data }
        : { data }
    }
    const handler = context.getHandler()

    return next.handle().pipe(
      map((data) => {
        if (typeof data === 'undefined') {
          return ''
        }
        // 分页转换
        if (this.reflector.get(HTTP_RES_TRANSFORM_PAGINATE, handler)) {
          return this.transformDataToPaginate(data)
        }

        // 对象转换成标准结构
        if (typeof data === 'object' && data !== null) {
          return reorganize(data)
        }

        return data
      }),
    )
  }

  private transformDataToPaginate(data: PaginateResult<T>): {
    data: T[]
    pagination: Paginator
  } {
    return {
      data: data.docs,
      pagination: {
        total: data.totalDocs,
        currentPage: data.page as number,
        totalPage: data.totalPages as number,
        size: data.limit,
        hasNextPage: data.hasNextPage,
        hasPrevPage: data.hasPrevPage,
      },
    }
  }
}

export class JSONSerializeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        return this.serialize(data)
      }),
    )
  }

  private serialize(obj: any) {
    if (!isObjectLike(obj)) {
      return obj
    }

    if (isArrayLike(obj)) {
      obj = Array.from(obj).map((i) => {
        return this.serialize(i)
      })
    } else {
      // if is Object

      if (obj.toJSON || obj.toObject) {
        obj = obj.toJSON?.() ?? obj.toObject?.()
      }

      const keys = Object.keys(obj)
      for (const key of keys) {
        const val = obj[key]
        // first
        if (!isObjectLike(val)) {
          continue
        }

        if (val.toJSON) {
          obj[key] = val.toJSON()
          // second
          if (!isObjectLike(obj[key])) {
            continue
          }
        }
        obj[key] = this.serialize(obj[key])
        // obj[key] = snakecaseKeys(obj[key])
      }
      obj = snakecaseKeys(obj)
      delete obj.v
    }
    return obj
  }
}
